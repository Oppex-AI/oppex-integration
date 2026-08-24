"""Single source of truth for the distribution version.

``setup.py`` reads this file textually and CI rewrites it from a ``python-v*``
release tag, so it must never import anything from the package.
"""

__version__ = "1.0.0.dev0"
