#!/usr/bin/env python3
"""Update Clavis release versions while preserving file formatting."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8-sig")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE | re.DOTALL)
    if count != 1:
        raise ValueError(f"expected exactly one version match in {path.name}; found {count}")
    path.write_text(updated, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("version")
    args = parser.parse_args()
    version = args.version

    replace_once(
        ROOT / "Cargo.toml",
        r'(^\[package\]\s*$.*?^version\s*=\s*")[^"]+("\s*$)',
        rf"\g<1>{version}\g<2>",
    )
    replace_once(
        ROOT / "Cargo.lock",
        r'(^\[\[package\]\]\s*\nname\s*=\s*"clavis"\s*\nversion\s*=\s*")[^"]+("\s*$)',
        rf"\g<1>{version}\g<2>",
    )
    replace_once(
        ROOT / "tauri.conf.json",
        r'("package"\s*:\s*\{.*?"version"\s*:\s*")[^"]+("\s*)',
        rf"\g<1>{version}\g<2>",
    )
    print(f"updated Cargo.toml, Cargo.lock, and tauri.conf.json to {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
