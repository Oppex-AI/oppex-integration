#!/bin/sh
# Keeps release/1.x's shared files in sync with feat/node-sdk. Everything under
# node/ except the 4 files in ALLOWED_TO_DIFFER is supposed to stay
# byte-identical between the two branches, and nothing else enforces that.
#
# Usage:
#   node/scripts/sync-release-1x.sh check   report drift, exit 1 if any is found
#   node/scripts/sync-release-1x.sh sync    copy feat/node-sdk's shared files onto
#                                            release/1.x, rebuild, run the full test
#                                            suite, and commit only if it passes
#
# This script is itself one of the files that must stay byte-identical between
# branches — if you change it, apply the same change to both.
set -eu

SOURCE_BRANCH="feat/node-sdk"
TARGET_BRANCH="release/1.x"
MODE="${1:-check}"

ALLOWED_TO_DIFFER="node/src/internal/transport.ts node/tsconfig.json node/package.json node/package-lock.json"

cd "$(git rev-parse --show-toplevel)"

is_allowed() {
  for allowed in $ALLOWED_TO_DIFFER; do
    [ "$1" = "$allowed" ] && return 0
  done
  return 1
}

DRIFTED=$(git diff --name-only "$TARGET_BRANCH" "$SOURCE_BRANCH" -- node/)
UNEXPECTED=""
for f in $DRIFTED; do
  is_allowed "$f" || UNEXPECTED="$UNEXPECTED $f"
done

case "$MODE" in
  check)
    if [ -z "$UNEXPECTED" ]; then
      echo "OK: no unexpected drift between $TARGET_BRANCH and $SOURCE_BRANCH."
      exit 0
    fi
    echo "Unexpected drift — these files should be identical but aren't:"
    for f in $UNEXPECTED; do echo "  - $f"; done
    exit 1
    ;;

  sync)
    if [ -z "$UNEXPECTED" ]; then
      echo "Nothing to sync."
      exit 0
    fi
    if [ -n "$(git status --porcelain)" ]; then
      echo "Working tree not clean — commit or stash before syncing." >&2
      exit 2
    fi

    echo "Syncing from $SOURCE_BRANCH onto $TARGET_BRANCH:"
    for f in $UNEXPECTED; do echo "  - $f"; done

    ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    git checkout "$TARGET_BRANCH"
    for f in $UNEXPECTED; do
      git checkout "$SOURCE_BRANCH" -- "$f"
    done

    (cd node && npm install --silent && npm run build --silent)
    (cd node && \
      node test/smoke.js && \
      node test/model/incidentRequest.test.js && \
      node test/internal/wireCodec.test.js && \
      node test/internal/retryExecutor.test.js && \
      node test/internal/asyncDispatcher.test.js && \
      node test/internal/transport.test.js && \
      node test/IncidentClient.test.js)

    git add $UNEXPECTED
    git commit -m "chore(node): sync shared files from $SOURCE_BRANCH"

    echo "Synced and committed on $TARGET_BRANCH. Returning to $ORIGINAL_BRANCH."
    git checkout "$ORIGINAL_BRANCH"
    (cd node && npm install --silent && npm run build --silent)
    ;;

  *)
    echo "Usage: $0 [check|sync]" >&2
    exit 2
    ;;
esac
