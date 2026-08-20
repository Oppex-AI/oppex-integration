#!/bin/sh
# Bumps this branch's node/package.json version, rebuilds, runs the full test suite,
# and commits + tags — never pushes, never publishes. Those stay explicit, separate
# steps (git push, npm publish) so a version cut is never silently made public.
#
# Usage:
#   node/scripts/release.sh <new-version>     e.g. node/scripts/release.sh 1.0.1
#
# Run from whichever branch you're actually releasing (release/1.x or feat/node-sdk).
# The resulting tag is language-qualified (node-vX.Y.Z), per root CLAUDE.md's rule that
# workflow/artifact/tag names must be language-qualified so they can't collide with a
# future Python/Go SDK's own version tags.
#
# This script is itself one of the files that must stay byte-identical between
# branches — if you change it, apply the same change to both.
set -eu

NEW_VERSION="${1:-}"
if [ -z "$NEW_VERSION" ]; then
  echo "Usage: $0 <new-version>" >&2
  exit 2
fi

if ! node -e "process.exit(/^[0-9]+\.[0-9]+\.[0-9]+\$/.test(process.argv[1]) ? 0 : 1)" "$NEW_VERSION"; then
  echo "Version must be a plain semver like 1.0.1 (no leading 'v', no prerelease suffix)." >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree not clean — commit or stash before releasing." >&2
  exit 2
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
CURRENT_VERSION=$(node -p "require('./node/package.json').version")
TAG="node-v${NEW_VERSION}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists." >&2
  exit 2
fi

if ! node -e "
  const cur = process.argv[1].split('.').map(Number);
  const next = process.argv[2].split('.').map(Number);
  const isNewer = next[0] > cur[0]
    || (next[0] === cur[0] && next[1] > cur[1])
    || (next[0] === cur[0] && next[1] === cur[1] && next[2] > cur[2]);
  process.exit(isNewer ? 0 : 1);
" "$CURRENT_VERSION" "$NEW_VERSION"; then
  echo "New version $NEW_VERSION must be greater than current $CURRENT_VERSION." >&2
  exit 2
fi

echo "Releasing $CURRENT_BRANCH: $CURRENT_VERSION -> $NEW_VERSION"

node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('./node/package.json', 'utf8'));
  pkg.version = process.argv[1];
  fs.writeFileSync('./node/package.json', JSON.stringify(pkg, null, 2) + '\n');
" "$NEW_VERSION"

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
git commit -m "release(node): v${NEW_VERSION}"
git tag "$TAG"

echo "Committed and tagged $TAG on $CURRENT_BRANCH."
echo "Not pushed, not published — run 'git push origin $CURRENT_BRANCH $TAG' and 'npm publish' explicitly when ready."
