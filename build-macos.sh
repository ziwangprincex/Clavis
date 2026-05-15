#!/usr/bin/env bash
# build-macos.sh — One-shot script to build Clavis .dmg on macOS (Apple Silicon).
#
# Usage:
#   chmod +x build-macos.sh
#   ./build-macos.sh
#
# After it finishes, the .dmg lives at:
#   target/release/bundle/dmg/Clavis_1.0.0_aarch64.dmg
#
# Requirements:
#   - macOS 11.0 or newer on Apple Silicon (M1+)
#   - Rust toolchain (curl https://sh.rustup.rs | sh)
#   - Xcode Command Line Tools (xcode-select --install)
#   - librsvg via Homebrew (brew install librsvg) — needed for tauri icon generation

set -euo pipefail

cd "$(dirname "$0")"

echo "==> 1/5: sanity checks"
if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: Rust toolchain not found. Install via:" >&2
  echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" >&2
  exit 1
fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo "ERROR: Xcode Command Line Tools not found. Run:" >&2
  echo "  xcode-select --install" >&2
  exit 1
fi
ARCH=$(uname -m)
echo "    cargo: $(cargo --version)"
echo "    arch : $ARCH (expect arm64 for Apple Silicon)"
if [[ "$ARCH" != "arm64" ]]; then
  echo "WARNING: not running on Apple Silicon. Build will produce x86_64 binary." >&2
fi

echo "==> 2/5: install tauri-cli (if missing)"
if ! cargo tauri --version >/dev/null 2>&1; then
  cargo install tauri-cli --version "^1.6"
else
  echo "    tauri-cli: $(cargo tauri --version)"
fi

echo "==> 3/5: generate icon.icns (if missing)"
if [[ ! -f icons/icon.icns ]]; then
  if [[ ! -f icons/icon.png ]]; then
    echo "ERROR: icons/icon.png is required to generate macOS icons" >&2
    exit 1
  fi
  cargo tauri icon icons/icon.png
fi

echo "==> 4/5: build (release; this takes 5-15 min on first run)"
cargo tauri build

echo "==> 5/5: locate output"
DMG_DIR="target/release/bundle/dmg"
if [[ -d "$DMG_DIR" ]]; then
  echo ""
  echo "BUILD COMPLETE. Artifacts:"
  ls -la "$DMG_DIR"
  echo ""
  echo "Drag the .dmg to your Applications folder, then double-click to install."
  echo "First launch: right-click Clavis.app -> Open (to bypass Gatekeeper for unsigned apps)."
else
  echo "WARNING: expected $DMG_DIR not found. Check earlier output for errors." >&2
  exit 1
fi
