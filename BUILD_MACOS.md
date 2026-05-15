# macOS Build Instructions

This document explains how to build Clavis as a `.dmg` installer on **macOS Apple Silicon (M1/M2/M3/M4)**.

## Prerequisites

Install once on the Mac:

1. **Xcode Command Line Tools** (~3 GB)
   ```
   xcode-select --install
   ```

2. **Rust toolchain**
   ```
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source $HOME/.cargo/env
   ```

3. **Homebrew + librsvg** (for icon generation)
   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install librsvg
   ```

4. **MacTeX** (only required to *use* Clavis for LaTeX — not for building)
   ```
   brew install --cask mactex
   ```

## Build

From the project directory:

```bash
chmod +x build-macos.sh
./build-macos.sh
```

The script will:

1. Verify Rust + Xcode are installed
2. Install `tauri-cli` if missing
3. Generate `icons/icon.icns` from `icons/icon.png` (if needed)
4. Run `cargo tauri build` — produces a release binary + .dmg
5. Print the path to the resulting `.dmg`

First build takes **5–15 minutes** depending on machine speed (compiles the entire Rust dependency tree and the Tauri runtime). Subsequent builds are seconds.

## Output

```
target/release/bundle/dmg/Clavis_1.0.0_aarch64.dmg
```

## Install on the Mac

1. Double-click the `.dmg`
2. Drag `Clavis.app` to the **Applications** folder
3. **First launch**: right-click `Clavis.app` in Finder → **Open** → confirm
   (Required because the app is unsigned. macOS will remember the choice; future launches work normally.)

If you double-click instead of right-click → Open, macOS will refuse with "Clavis cannot be opened because the developer cannot be verified." You'd then need to go to **System Settings → Privacy & Security → "Open Anyway"**.

## Troubleshooting

### "Failed to execute beforeBuildCommand"
Our `tauri.conf.json` has empty `beforeBuildCommand`/`beforeDevCommand`, so this should not happen. If it does, ensure those keys are still empty.

### Icon generation fails with "rsvg-convert not found"
```
brew install librsvg
```

### "linker `cc` not found"
```
xcode-select --install
```

### Build succeeds but `.dmg` is missing
Check `target/release/bundle/`. Tauri may produce only `.app` if dmg packaging fails. You can ship the `.app` directly (zip it: `zip -r Clavis.zip Clavis.app`).

### LaTeX engine not found at runtime
The app searches PATH plus these macOS fallback locations:
- `/Library/TeX/texbin` (MacTeX default)
- `/usr/local/texlive/{2024,2025,2026}/bin/universal-darwin`
- `/opt/homebrew/bin`
- `/usr/local/bin`

If MacTeX is installed elsewhere, use **Settings → LaTeX engines → Custom path**.

## Cross-platform note

You **cannot** build a macOS `.dmg` on Windows or Linux. Tauri (and Apple's tooling) require running on macOS for code-signing-compatible bundle creation, even when not signing.
