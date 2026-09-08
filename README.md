<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="icons/logo-source-dark.svg">
    <img src="icons/logo-source.svg" alt="Clavis" width="128" height="128">
  </picture>
</p>

<h1 align="center">Clavis</h1>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

A desktop writing app for Markdown, LaTeX, and Typst.

## Features

- Live preview, math rendering, and PDF export.
- LaTeX compilation with SyncTeX, multi-file outlines, and BibTeX citations.
- Tabs, workspace search and replace, and a command palette.
- Autosave and session restore.

## Install

Download from [Releases](https://github.com/ziwangprincex/Clavis/releases/latest):
Windows `.exe`, macOS `.dmg`, or Linux `.AppImage`.

On Apple Silicon Macs, you can also use Homebrew:

```bash
brew install --cask ziwangprincex/clavis/clavis
```

Typst is built in. LaTeX requires TeX Live or MacTeX; use XeLaTeX for CJK text
and custom fonts. Quarto and Pandoc exports require those tools separately.

## Use

Open a file or folder to start writing. Most actions are in the command palette.

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Command palette | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| Compile | `Cmd+B` | `Ctrl+B` |
| Workspace search | `Cmd+Shift+F` | `Ctrl+Shift+F` |

Check for updates in Settings → Updates.

## Development

Requires Rust 1.92+, Node.js 22 LTS (22.13+), and
[Tauri 1 system dependencies](https://v1.tauri.app/v1/guides/getting-started/prerequisites).
Run from the repository root:

```bash
npm --prefix web ci
npm run tauri -- dev
```

Checks:

```bash
npm run typecheck
npm test
cargo test --locked
```

See [macOS builds](BUILD_MACOS.md) for packaging and [releasing](RELEASING.md)
for the release process.
