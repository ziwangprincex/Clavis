#!/usr/bin/env python3
"""Require docs/HANDOFF.md updates whenever repository files change."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXEMPT_FILES = {"docs/HANDOFF.md"}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True, encoding="utf-8").strip()


def changed_files(base: str, head: str) -> set[str]:
    if not base or set(base) == {"0"}:
        base = f"{head}^"
    output = git("diff", "--name-only", f"{base}...{head}")
    return {line.replace("\\", "/") for line in output.splitlines() if line.strip()}


def requires_handoff(path: str) -> bool:
    return path not in EXEMPT_FILES


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", default="HEAD")
    args = parser.parse_args()

    try:
        changed = changed_files(args.base, args.head)
    except subprocess.CalledProcessError as exc:
        print(f"handoff guard failed to inspect git diff: {exc}", file=sys.stderr)
        return 1

    watched = sorted(path for path in changed if requires_handoff(path))
    if not watched:
        print("handoff guard: no changes requiring a handoff update")
        return 0
    if "docs/HANDOFF.md" in changed:
        print(f"handoff guard: docs/HANDOFF.md updated for {len(watched)} watched file(s)")
        return 0

    print("handoff guard failed: docs/HANDOFF.md must be updated whenever repository files change:", file=sys.stderr)
    for path in watched:
        print(f"  - {path}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
