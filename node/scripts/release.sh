#!/bin/sh
# Releases either or both SDK variants, on the current branch (in practice, always
# master — the single trunk this SDK lives on). No branch switching happens: the
# version bump is committed directly where you already are, and a release branch is
# then cut to point at that exact commit — the release branch is a snapshot taken
# AFTER the bump, never something master has to catch up to later.
#
# Usage:
#   node/scripts/release.sh <legacy-version|-> <modern-version|->
#
# Pass "-" for either argument to skip that variant's release. At least one real
# version must be given. For each variant released:
#   1. Bump node/variants/<variant>/package.json's version
#   2. Build + test that variant (node/scripts/build-variant.sh <variant>) BEFORE
#      committing, so a bad bump never lands
#   3. Commit the bump on the current branch
#   4. Create node-release-<version> pointing at that commit (git branch, no checkout)
#
# Never pushes, never runs npm publish — those stay explicit, separate, manual steps.
# Refuses a dirty working tree, a version that isn't a plain X.Y.Z semver, a version
# that isn't strictly newer than that variant's current one, an already-existing
# release branch, or a failing test run.
set -eu

LEGACY_VERSION="${1:-}"
MODERN_VERSION="${2:-}"

if [ -z "$LEGACY_VERSION" ] || [ -z "$MODERN_VERSION" ]; then
  echo "Usage: $0 <legacy-version|-> <modern-version|->" >&2
  exit 2
fi
if [ "$LEGACY_VERSION" = "-" ] && [ "$MODERN_VERSION" = "-" ]; then
  echo "At least one version must be given (use '-' to skip the other)." >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree not clean — commit or stash before releasing." >&2
  exit 2
fi

validate_version() {
  if ! node -e "process.exit(/^[0-9]+\.[0-9]+\.[0-9]+\$/.test(process.argv[1]) ? 0 : 1)" "$1"; then
    echo "Version must be a plain semver like 1.0.1 (no leading 'v', no prerelease suffix)." >&2
    exit 2
  fi
}

is_newer() {
  node -e "
    const cur = process.argv[1].split('.').map(Number);
    const next = process.argv[2].split('.').map(Number);
    const isNewer = next[0] > cur[0]
      || (next[0] === cur[0] && next[1] > cur[1])
      || (next[0] === cur[0] && next[1] === cur[1] && next[2] > cur[2]);
    process.exit(isNewer ? 0 : 1);
  " "$1" "$2"
}

release_variant() {
  variant="$1"
  new_version="$2"
  pkg_path="node/variants/${variant}/package.json"
  tag_branch="node-release-${new_version}"

  validate_version "$new_version"

  if git show-ref --verify --quiet "refs/heads/${tag_branch}"; then
    echo "Branch $tag_branch already exists." >&2
    exit 2
  fi

  current_version=$(node -p "require('./${pkg_path}').version")
  if ! is_newer "$current_version" "$new_version"; then
    echo "New version $new_version must be greater than current $current_version ($variant)." >&2
    exit 2
  fi

  echo "Releasing $variant: $current_version -> $new_version"

  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('./${pkg_path}', 'utf8'));
    pkg.version = process.argv[1];
    fs.writeFileSync('./${pkg_path}', JSON.stringify(pkg, null, 2) + '\n');
  " "$new_version"

  node/scripts/build-variant.sh "$variant"

  # npm install (inside build-variant.sh) syncs the STAGED package-lock.json's own
  # version field to match the bump, but that staged copy is gitignored — copy it back
  # to the real source of truth so the lockfile's version actually stays in sync too.
  cp "node/package-lock.json" "node/variants/${variant}/package-lock.json"

  git add "$pkg_path" "node/variants/${variant}/package-lock.json"
  git commit -m "release(node): v${new_version} (${variant})"
  git branch "$tag_branch"

  echo "Committed the bump and created $tag_branch at $(git rev-parse --short HEAD)."
}

if [ "$LEGACY_VERSION" != "-" ]; then
  release_variant "legacy" "$LEGACY_VERSION"
fi
if [ "$MODERN_VERSION" != "-" ]; then
  release_variant "modern" "$MODERN_VERSION"
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo
echo "Not pushed, not published. When ready:"
echo "  git push origin ${CURRENT_BRANCH}"
if [ "$LEGACY_VERSION" != "-" ]; then
  echo "  git push origin node-release-${LEGACY_VERSION}"
  echo "  git checkout node-release-${LEGACY_VERSION} && (cd node && ./scripts/build-variant.sh legacy && npm publish --tag legacy)   # --tag legacy: never let a 1.x publish move the 'latest' dist-tag backward"
fi
if [ "$MODERN_VERSION" != "-" ]; then
  echo "  git push origin node-release-${MODERN_VERSION}"
  echo "  git checkout node-release-${MODERN_VERSION} && (cd node && ./scripts/build-variant.sh modern && npm publish)"
fi
