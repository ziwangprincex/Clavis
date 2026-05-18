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

3. **Node.js 18+ and npm** (the frontend is a Vite + React + TypeScript project)
   ```
   brew install node
   ```
   Or download an installer from https://nodejs.org/.

4. **Homebrew + librsvg** (for icon generation)
   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install librsvg
   ```

5. **MacTeX** (only required to *use* Clavis for LaTeX — not for building)
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

1. Verify Rust + Node + Xcode are installed
2. Install web dependencies (`npm ci` if `web/package-lock.json` is present, else `npm install`)
3. Install `tauri-cli` if missing
4. Generate `icons/icon.icns` from `icons/icon.png` (if needed)
5. Run `cargo tauri build` — this triggers the configured `beforeBuildCommand`
   (`npm --prefix web run build`) to produce the static frontend at
   `web/dist/`, then bundles it into the Rust binary and produces the `.dmg`
6. Print the path to the resulting `.dmg`

First build takes **5–15 minutes** depending on machine speed (compiles the entire Rust dependency tree and the Tauri runtime). Subsequent builds are seconds.

> **Note**: The shipped `.dmg` is fully self-contained. Node and npm are only used at build time to compile the frontend; they are **not** required on the end user's machine.

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
The frontend build (`npm --prefix web run build`) failed. Run it manually to see the underlying error:
```
cd web && npm install && npm run build
```
Common causes: stale `node_modules` after pulling — delete `web/node_modules` and re-run `npm install`.

### "npm: command not found"
Install Node.js 18+ — see prerequisites above.

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
