#!/bin/sh
# Releases both SDK majors in one invocation, from whichever branch is currently
# checked out — you don't need to check out release/1.x or feat/node-sdk yourself
# first. For each branch, bumps node/package.json's version, rebuilds, runs the full
# test suite, and commits + tags (node-vX.Y.Z). Never pushes, never runs npm publish —
# those stay explicit, separate, manual steps for each branch.
#
# Usage:
#   node/scripts/release.sh <release/1.x-version|-> <feat/node-sdk-version|->
#
# Pass "-" for either argument to skip that branch's release (e.g. to release only the
# modern major this time). At least one real version must be given.
#
# Creates release/1.x and/or feat/node-sdk locally (tracking origin) if they don't
# already exist locally — e.g. on a fresh clone. Always returns to whichever branch
# was checked out when the script started, regardless of outcome. Stops immediately —
# before touching the second branch — if the first branch's release fails for any
# reason (bad version, dirty tree, failing test, etc.).
#
# This script is itself one of the files that must stay byte-identical between
# branches — if you change it, apply the same change to both.
set -eu

LEGACY_VERSION="${1:-}"
MODERN_VERSION="${2:-}"

if [ -z "$LEGACY_VERSION" ] || [ -z "$MODERN_VERSION" ]; then
  echo "Usage: $0 <release/1.x-version|-> <feat/node-sdk-version|->" >&2
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

ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# `exit` inside release_branch below terminates the whole script immediately — this
# trap is what actually guarantees a return to the original branch even on early
# failure, since a plain "git checkout $ORIGINAL_BRANCH at the bottom of the script"
# would never be reached in that case.
cleanup() {
  current="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$current" = "$ORIGINAL_BRANCH" ]; then
    return
  fi
  if [ -n "$(git status --porcelain)" ]; then
    echo "Left on $current with an uncommitted, failed release attempt." >&2
    echo "Run 'git checkout -- node/package.json node/package-lock.json', then 'git checkout $ORIGINAL_BRANCH'." >&2
    return
  fi
  git checkout "$ORIGINAL_BRANCH" >/dev/null 2>&1 || return
  (cd node && npm install --silent && npm run build --silent) >/dev/null 2>&1 || true
}
trap cleanup EXIT

ensure_branch_exists() {
  branch="$1"
  if git show-ref --verify --quiet "refs/heads/${branch}"; then
    return 0
  fi
  if git show-ref --verify --quiet "refs/remotes/origin/${branch}"; then
    git branch "$branch" "origin/${branch}"
  else
    echo "Branch $branch doesn't exist locally or on origin." >&2
    exit 2
  fi
}

release_branch() {
  branch="$1"
  new_version="$2"

  if ! node -e "process.exit(/^[0-9]+\.[0-9]+\.[0-9]+\$/.test(process.argv[1]) ? 0 : 1)" "$new_version"; then
    echo "Version must be a plain semver like 1.0.1 (no leading 'v', no prerelease suffix)." >&2
    exit 2
  fi

  ensure_branch_exists "$branch"
  git checkout "$branch"

  current_version=$(node -p "require('./node/package.json').version")
  tag="node-v${new_version}"

  if git rev-parse "$tag" >/dev/null 2>&1; then
    echo "Tag $tag already exists." >&2
    exit 2
  fi

  if ! node -e "
    const cur = process.argv[1].split('.').map(Number);
    const next = process.argv[2].split('.').map(Number);
    const isNewer = next[0] > cur[0]
      || (next[0] === cur[0] && next[1] > cur[1])
      || (next[0] === cur[0] && next[1] === cur[1] && next[2] > cur[2]);
    process.exit(isNewer ? 0 : 1);
  " "$current_version" "$new_version"; then
    echo "New version $new_version must be greater than current $current_version on $branch." >&2
    exit 2
  fi

  echo "Releasing $branch: $current_version -> $new_version"

  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('./node/package.json', 'utf8'));
    pkg.version = process.argv[1];
    fs.writeFileSync('./node/package.json', JSON.stringify(pkg, null, 2) + '\n');
  " "$new_version"

  (cd node && npm install --silent && npm run build --silent)
  (cd node && \
    node test/smoke.js && \
    node test/model/incidentRequest.test.js && \
    node test/internal/wireCodec.test.js && \
    node test/internal/retryExecutor.test.js && \
    node test/internal/asyncDispatcher.test.js && \
    node test/internal/transport.test.js && \
    node test/IncidentClient.test.js)

  git add node/package.json node/package-lock.json
  git commit -m "release(node): v${new_version}"
  git tag "$tag"

  echo "Committed and tagged $tag on $branch."
}

if [ "$LEGACY_VERSION" != "-" ]; then
  release_branch "release/1.x" "$LEGACY_VERSION"
fi

if [ "$MODERN_VERSION" != "-" ]; then
  release_branch "feat/node-sdk" "$MODERN_VERSION"
fi

echo
echo "Done. Returned to $ORIGINAL_BRANCH."
echo "Not pushed, not published. When ready:"
if [ "$LEGACY_VERSION" != "-" ]; then
  echo "  git push origin release/1.x node-v${LEGACY_VERSION}"
  echo "  git checkout node-v${LEGACY_VERSION} && (cd node && npm publish --tag legacy)   # --tag legacy: never let a 1.x publish move the 'latest' dist-tag backward"
fi
if [ "$MODERN_VERSION" != "-" ]; then
  echo "  git push origin feat/node-sdk node-v${MODERN_VERSION}"
  echo "  git checkout node-v${MODERN_VERSION} && (cd node && npm publish)"
fi
