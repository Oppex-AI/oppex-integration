#!/bin/sh
# Local, manually-run sanity sweep across every supported Node version, each inside the
# real official node:<version> Docker image — not a CI job. CI (node-compatibility.yml)
# runs on bare ubuntu-latest via actions/setup-node, which is enough to catch a real
# compile/runtime break on a given Node version, but proves nothing about the exact
# environment a consumer's own Docker deployment would actually run in. This script is
# that missing guarantee: run it before cutting a release, or any time you want the
# same coverage this repo used to get from container-based CI jobs.
#
# For each variant, builds a fresh tarball via build-variant.sh + npm pack, then
# installs it inside node:<version> for every version in that variant's supported
# range, and runs the exact same network-free external consumer CI already trusts
# (.github/smoke/node/consumer.js) against it — one behavior, one file, no separate
# demo script to keep in sync.
#
# Requires Docker (or a compatible engine) running locally.
#
# Usage:
#   node/scripts/docker-sanity.sh
set -eu

cd "$(git rev-parse --show-toplevel)/node"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

CONSUMER_JS="$(pwd)/../.github/smoke/node/consumer.js"
LEGACY_VERSIONS="8 16 17"
MODERN_VERSIONS="18 20 22 24 26"

# Packs the requested variant and renames the result to a fixed path, since npm pack's
# own output filename is version-derived and each variant's package.json carries a
# different version — a fixed name is simpler for the rest of this script to reference
# than re-deriving npm pack's naming convention.
pack() {
  variant="$1"
  ./scripts/build-variant.sh "$variant" >/dev/null
  npm pack --silent --pack-destination "$WORKDIR" >/dev/null
  mv "$WORKDIR"/oppex-integration-sdk-*.tgz "$WORKDIR/${variant}.tgz"
}

echo "Building legacy tarball..."
legacy_tgz="$WORKDIR/legacy.tgz"
pack legacy

echo "Building modern tarball..."
modern_tgz="$WORKDIR/modern.tgz"
pack modern

results=""

# node:8 has no linux/arm64 image published — force the emulated amd64 image on
# Apple Silicon and anywhere else that isn't natively amd64, same as the local
# oppex-integration-testing/docker compose file already does for this exact version.
run_one() {
  label="$1"
  node_version="$2"
  tgz="$3"
  platform_args=""
  if [ "$node_version" = "8" ]; then
    platform_args="--platform linux/amd64"
  fi
  echo "=== $label (node:$node_version) ==="
  if docker run --rm $platform_args \
    -v "$tgz:/app/sdk.tgz:ro" \
    -v "$CONSUMER_JS:/app/consumer.js:ro" \
    -w /app \
    "node:$node_version" \
    sh -c "npm install /app/sdk.tgz --silent && node consumer.js"
  then
    results="$results ${label}:PASS"
  else
    results="$results ${label}:FAIL"
  fi
  echo ""
}

# v1 (legacy: http/https transport, Node >=8 floor) — tested across its whole range.
for v in $LEGACY_VERSIONS; do
  run_one "legacy-node$v" "$v" "$legacy_tgz"
done

# v2 (modern: fetch transport, Node >=18 floor) — tested across its whole range.
for v in $MODERN_VERSIONS; do
  run_one "modern-node$v" "$v" "$modern_tgz"
done

# Anti-test: the modern tarball (fetch-only, tsc target ES2022) has no business running
# on Node 8 — this is EXPECTED to fail, specifically with a SyntaxError at module load
# (ES2022 class-field syntax predates Node 8's parser), not a generic crash. A pass here
# would mean the documented Node 18 floor isn't real at runtime, only in documentation.
echo "=== anti-test: modern on node:8 (expected to fail) ==="
if docker run --rm --platform linux/amd64 \
  -v "$modern_tgz:/app/sdk.tgz:ro" \
  -v "$CONSUMER_JS:/app/consumer.js:ro" \
  -w /app \
  node:8 \
  sh -c "npm install /app/sdk.tgz --silent && node consumer.js"
then
  results="$results anti-test-modern-on-node8:UNEXPECTED_PASS"
else
  results="$results anti-test-modern-on-node8:EXPECTED_FAIL"
fi
echo ""

echo "=== Summary ==="
for r in $results; do
  echo "$r"
done

case "$results" in
  *:FAIL*|*UNEXPECTED_PASS*)
    echo "One or more checks did not behave as expected." >&2
    exit 1
    ;;
esac

echo "All versions behaved as expected."
