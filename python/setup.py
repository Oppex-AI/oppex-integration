"""Packaging for the Oppex Python SDK.

Kept as ``setup.py`` because the distribution must build a universal
``py2.py3-none-any`` wheel with the Python 2.7-era toolchain that CI uses to
produce the canonical artifact.
"""

from __future__ import absolute_import

import io
import os
import re

from setuptools import find_packages, setup

HERE = os.path.abspath(os.path.dirname(__file__))


def read(*parts):
    with io.open(os.path.join(HERE, *parts), encoding="utf-8") as handle:
        return handle.read()


def find_version():
    # Read textually so packaging never imports the package it is building.
    match = re.search(r'^__version__ = "([^"]+)"$',
                      read("src", "oppex_sdk", "_version.py"), re.M)
    if not match:
        raise RuntimeError("Unable to read the SDK version from src/oppex_sdk/_version.py")
    return match.group(1)


setup(
    name="oppex-integration-sdk",
    version=find_version(),
    description="Python SDK for posting incidents to Oppex",
    long_description=read("README.md"),
    long_description_content_type="text/markdown",
    url="https://github.com/Oppex-AI/oppex-integration",
    author="Oppex Engineering",
    license="Apache-2.0",
    package_dir={"": "src"},
    packages=find_packages("src"),
    include_package_data=False,
    zip_safe=False,
    # The SDK is standard library only, on every supported interpreter.
    install_requires=[],
    python_requires=">=2.7, !=3.0.*, !=3.1.*, !=3.2.*, !=3.3.*, !=3.4.*",
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Intended Audience :: System Administrators",
        "License :: OSI Approved :: Apache Software License",
        "Operating System :: OS Independent",
        "Programming Language :: Python",
        "Programming Language :: Python :: 2",
        "Programming Language :: Python :: 2.7",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.5",
        "Programming Language :: Python :: 3.6",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Programming Language :: Python :: 3.13",
        "Programming Language :: Python :: 3.14",
        "Programming Language :: Python :: Implementation :: CPython",
        "Topic :: System :: Monitoring",
    ],
    project_urls={
        "Source": "https://github.com/Oppex-AI/oppex-integration",
        "Homepage": "https://oppex.ai",
    },
)
