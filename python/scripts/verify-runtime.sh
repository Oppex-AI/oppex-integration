#!/bin/sh
# Installs a canonical wheel and proves it works on the interpreter running this
# script: the shipped bytes import, the full test suite passes, and an external
# consumer that only uses the supported API compiles and runs.
#
# Usage: verify-runtime.sh <wheel> [repository-root]
set -eu

wheel="${1:?usage: verify-runtime.sh <wheel> [repository-root]}"
repository_root="${2:-$(cd "$(dirname "$0")/../.." && pwd)}"

python -V
python -m pip install --disable-pip-version-check --no-index --no-deps \
    --force-reinstall "${wheel}"

cd "${repository_root}"

installed_package="$(python -c 'import os, oppex_sdk; print(os.path.dirname(oppex_sdk.__file__))')"
python -m compileall -q "${installed_package}"
python -m compileall -q python/tests python/examples .github/smoke/python
python -c 'import oppex_sdk, sys; sys.stdout.write("oppex-integration-sdk " + oppex_sdk.__version__ + "\n")'

python -m unittest discover -s python/tests -t python

smoke_output="$(python .github/smoke/python/external_consumer.py)"
printf '%s\n' "${smoke_output}"
case "${smoke_output}" in
    *EXTERNAL_CONSUMER_OK*) ;;
    *) echo "External consumer did not report success" >&2; exit 1 ;;
esac
