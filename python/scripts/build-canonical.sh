#!/bin/sh
# Builds the canonical, dependency-free artifacts for the Python SDK.
#
# Runs on Python 2.7 so the published bytes are proven to compile on the oldest
# supported interpreter, and so the toolchain that emits a universal
# py2.py3-none-any wheel is the one that natively supports it.
set -eu

cd "$(dirname "$0")/.."

python -V
# A Python 3 build produces the same wheel contents and is useful locally, but
# only a 2.7 build byte-compiles the tree at the interpreter floor it claims.
case "$(python -c 'import sys; sys.stdout.write("%d" % sys.version_info[0])')" in
    2) ;;
    *) echo "NOTE: not running on Python 2.7; this artifact is for local use, not release." >&2 ;;
esac

# The Python analogue of compiling the library with an old -source level.
python -m compileall -q src tests examples

rm -rf build dist
rm -rf src/oppex_integration_sdk.egg-info src/oppex-integration-sdk.egg-info

python -m pip install --disable-pip-version-check --requirement requirements-build.txt
python setup.py --quiet sdist bdist_wheel

# PyPI rejects an sdist whose filename is not the PEP 625 normalised project
# name. A wheel filename is normalised by the wheel format itself, but
# setuptools on Python 2.7 predates PEP 625 and names the sdist from the raw
# project name, so normalise it here -- while these are still build outputs --
# rather than renaming released bytes after the matrix has checksummed them.
project_name="$(python setup.py --name)"
release_version="$(python setup.py --version)"
normalised_name="$(python -c 'import re, sys; sys.stdout.write(re.sub(r"[-_.]+", "_", sys.argv[1]))' "${project_name}")"
raw_sdist="dist/${project_name}-${release_version}.tar.gz"
normalised_sdist="dist/${normalised_name}-${release_version}.tar.gz"
if [ "${raw_sdist}" != "${normalised_sdist}" ] && [ -f "${raw_sdist}" ]; then
    mv "${raw_sdist}" "${normalised_sdist}"
fi
test -s "${normalised_sdist}"

ls -l dist
