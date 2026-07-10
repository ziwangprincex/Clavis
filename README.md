# Clavis

[English](README.md) · [简体中文](README.zh-CN.md)

A desktop editor for Markdown, LaTeX, and Typst, built with Tauri. It has live
preview, LaTeX compilation with SyncTeX, BibTeX support, and PDF search.

## Features

- Markdown preview with KaTeX math
- LaTeX compilation (pdflatex / xelatex / lualatex), PDF preview, and SyncTeX (jump between source and PDF)
- Typst preview and PDF export
- Multi-file LaTeX projects: a combined outline, clickable `\input`/`\include`, compile errors that open the right file, and citations that open their `.bib` entry
- Tabs, a folder tree, a command palette, and keyboard shortcuts
- Autosave and session restore; recent files and folders
- Settings grouped into categories (Appearance, Editor, LaTeX & PDF, Preview, Updates)
- Project fonts and assets are bundled into the compile directory automatically
- Built-in update check

## Install

Download the installer for your platform from the
[Releases page](https://github.com/ziwangprincex/Clavis/releases/latest):

- Windows — `.exe`
- macOS — `.dmg`
- Linux — `.AppImage`

The app isn't signed with an OS certificate yet, so on first launch Windows
SmartScreen or macOS Gatekeeper may warn you. Choose "Open anyway" / "Run anyway".

### Updates

Clavis checks for updates when it starts. You can also check manually from
**Settings → Updates → Check for Updates**, or the command palette
(`Ctrl/Cmd+Shift+P`) → "Check for Updates…". When there's a new version it asks
first, then downloads and restarts into it.

### LaTeX and Typst

- LaTeX is optional. Install TeX Live or MiKTeX if you want it (XeLaTeX handles
  CJK and custom fonts best).
- Typst needs nothing extra; it's built in.

## Build from source

For development. To just use the app, download an installer above.

You need Rust 1.75+, Node.js 18+, and the system dependencies Tauri needs
(WebView2 on Windows, Xcode command line tools on macOS, `webkit2gtk-4.0` and
friends on Linux).

```bash
git clone https://github.com/ziwangprincex/Clavis.git
cd Clavis
cd web && npm install && cd ..
cargo tauri dev          # opens a window with hot reload
```

The first build compiles a lot of Rust crates and takes several minutes; later
builds are fast.

### Tests

```bash
cargo test               # Rust
cd web && npm test       # frontend (Vitest)
```

### Package an installer

```bash
cargo tauri build
```

Output is under `target/release/bundle/`. For the macOS build script see
[`BUILD_MACOS.md`](BUILD_MACOS.md); for how releases are cut see
[`RELEASING.md`](RELEASING.md).

## Tips

- Pick a file or folder to work in when you start.
- XeLaTeX is the safest choice for CJK and custom fonts.
- Command palette: `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS). Compile: `Ctrl+B` / `Cmd+B`.

## Notes

Build artifacts aren't committed. The security model is described in
[`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md).
