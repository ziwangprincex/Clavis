#!/usr/bin/env python3
"""Validate Clavis release metadata and (optionally) the release tag."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$")


def cargo_version() -> str:
    text = (ROOT / "Cargo.toml").read_text(encoding="utf-8")
    package_match = re.search(r"(?ms)^\[package\]\s*$(.*?)(?=^\[|\Z)", text)
    if not package_match:
        raise ValueError("Cargo.toml has no [package] section")
    version_match = re.search(r'(?m)^version\s*=\s*"([^"]+)"\s*$', package_match.group(1))
    if not version_match:
        raise ValueError("Cargo.toml [package] has no version")
    return version_match.group(1)


def lock_version() -> str:
    text = (ROOT / "Cargo.lock").read_text(encoding="utf-8")
    match = re.search(
        r'(?ms)^\[\[package\]\]\s*$\nname\s*=\s*"clavis"\s*$\nversion\s*=\s*"([^"]+)"\s*$',
        text,
    )
    if not match:
        raise ValueError("Cargo.lock has no clavis package version")
    return match.group(1)


def tauri_version() -> str:
    data = json.loads((ROOT / "tauri.conf.json").read_text(encoding="utf-8"))
    version = data.get("package", {}).get("version")
    if not isinstance(version, str):
        raise ValueError("tauri.conf.json package.version is missing")
    return version


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", help="release tag, e.g. v1.0.2")
    args = parser.parse_args()

    try:
        cargo = cargo_version()
        lock = lock_version()
        tauri = tauri_version()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"release preflight failed: {exc}", file=sys.stderr)
        return 1

    errors: list[str] = []
    if not SEMVER.fullmatch(cargo):
        errors.append(f"Cargo.toml version is not SemVer: {cargo}")
    if not SEMVER.fullmatch(lock):
        errors.append(f"Cargo.lock version is not SemVer: {lock}")
    if not SEMVER.fullmatch(tauri):
        errors.append(f"tauri.conf.json version is not SemVer: {tauri}")
    if len({cargo, lock, tauri}) != 1:
        errors.append(
            f"version mismatch: Cargo.toml={cargo}, Cargo.lock={lock}, tauri.conf.json={tauri}"
        )

    if args.tag:
        expected = f"v{tauri}"
        if args.tag != expected:
            errors.append(f"tag mismatch: received {args.tag}, expected {expected}")

    if errors:
        for error in errors:
            print(f"release preflight failed: {error}", file=sys.stderr)
        return 1

    tag_note = f", tag={args.tag}" if args.tag else ""
    print(f"release metadata OK: version={tauri}{tag_note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
