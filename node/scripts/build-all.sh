#!/bin/sh
# Builds and tests BOTH variants in one run, before raising a PR (or before
# publishing) — replaces the old release.sh's version-bump-and-branch-cut flow now
# that releases happen straight from master, with no per-release git branch at all.
# Version bumps are now a plain, reviewed edit to
# node/variants/<variant>/package.json's "version" field, made like any other change
# in the PR — this script's job is only to verify both variants still build and pass
# after whatever changed (including a version bump), and to sync each variant's
# committed package-lock.json to match.
#
# Produces two independent, persistent output directories side by side —
# node/dist-legacy/ and node/dist-modern/ — rather than the single, swapped node/dist/
# that build-variant.sh leaves behind (which only ever holds whichever variant ran
# last). Both are gitignored, generated output, same as node/dist/ itself.
#
# Usage:
#   node/scripts/build-all.sh
set -eu

cd "$(git rev-parse --show-toplevel)/node"

for variant in legacy modern; do
  echo "=== $variant ==="

  # build-variant.sh's own `ln -sf` already force-overwrites whatever transport.ts
  # currently points at, so this isn't fixing a real bug — it just means each variant
  # starts its build from a clean slate (no symlink sitting there at all) rather than
  # one already pointing at the other variant's source, which is easier to reason
  # about when reading this script than trusting -f silently did the right thing.
  rm -f src/internal/transport.ts
  ./scripts/build-variant.sh "$variant"

  # npm install (inside build-variant.sh) syncs the STAGED package-lock.json's own
  # version field to whatever's currently in that variant's package.json, but the
  # staged copy is gitignored — copy it back to the real, committed source of truth so
  # a version bump's lockfile update actually lands in the PR too, not just on disk.
  cp package-lock.json "variants/${variant}/package-lock.json"

  rm -rf "dist-${variant}"
  cp -r dist "dist-${variant}"
  echo ""
done

# No variant's symlink left dangling once this script is done — the next thing to run
# it (build-variant.sh, docker-sanity.sh, or this script again) starts clean either way.
rm -f src/internal/transport.ts

echo "Built and tested both variants successfully."
echo "  legacy dist: node/dist-legacy/"
echo "  modern dist: node/dist-modern/"
echo ""
echo "If a version bump is part of this change, variants/<variant>/package-lock.json"
echo "has already been re-synced above — review it along with the version bump itself"
echo "before committing."
