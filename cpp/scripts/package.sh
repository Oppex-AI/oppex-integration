#!/usr/bin/env bash
# Builds the release source archive and its checksum.
#
# The archive is what a GitHub Release carries: there is no canonical C or C++
# package registry, so the published artifact is the source a consumer builds
# with CMake. It is produced once here, verified by the external smoke consumer
# against those exact bytes, and attached to the release without rebuilding.
set -euo pipefail

cpp_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_directory="${1:-${cpp_directory}/dist}"

version="$(sed -n 's/.*OPPEX_SDK_VERSION "\([0-9.]*\)".*/\1/p' "${cpp_directory}/src/version.hpp")"
if [[ -z "${version}" ]]; then
  echo "Could not read OPPEX_SDK_VERSION from src/version.hpp" >&2
  exit 1
fi

name="oppex-integration-sdk-cpp-${version}"
staging="$(mktemp -d)"
trap 'rm -rf "${staging}"' EXIT

mkdir -p "${staging}/${name}"
# Everything a consumer needs to build, test and read the SDK, and nothing
# generated. Keep this list in step with cpp/CLAUDE.md's directory ownership.
for entry in CMakeLists.txt CLAUDE.md README.md LICENSE cmake include src tests examples scripts; do
  cp -R "${cpp_directory}/${entry}" "${staging}/${name}/"
done

mkdir -p "${output_directory}"
tar --create --gzip \
    --file "${output_directory}/${name}.tar.gz" \
    --directory "${staging}" \
    "${name}"

cd "${output_directory}"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${name}.tar.gz" > "${name}.tar.gz.sha256"
else
  shasum --algorithm 256 "${name}.tar.gz" > "${name}.tar.gz.sha256"
fi

echo "${output_directory}/${name}.tar.gz"
