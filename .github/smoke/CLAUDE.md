# Isolated Consumer Smoke Guide

Read the repository-level `CLAUDE.md` and `.github/CLAUDE.md` first.

This directory holds small, language-specific consumers compiled or executed by GitHub Actions against a built distribution artifact. A smoke consumer must not rely on implementation-module outputs or undeclared repository classpaths.

Use one subdirectory per language. Keep each consumer network-free, deterministic, and free of real credentials. Its success marker must be emitted only after public API construction and representative bundled-dependency linkage succeed.
