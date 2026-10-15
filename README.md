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

Clavis is a desktop editor for Markdown, LaTeX and Typst documents.

## Features

- Markdown is edited in a formatted view. Headings, emphasis, lists, tables,
  formulas, footnotes, highlighted code, Mermaid diagrams and images are
  rendered in place; the Markdown source is shown only at the cursor.
- Images pasted or dropped into a saved Markdown document are copied into a
  folder beside it (`assets`, `<document>.assets` or one of your choice, also
  per document with `typora-copy-images-to` in its front matter) and linked by
  relative path.
- Optional smart punctuation turns straight quotes into curly ones and `--` /
  `---` into en and em dashes as you type.
- Markdown also accepts YAML front matter, `==highlight==`, `^superscript^`,
  `~subscript~` and GitHub-style `> [!NOTE]` callouts. A toolbar above a table
  being edited aligns columns; its menus insert, move and delete rows and
  columns, copy the table or delete it.
- Markdown documents export as one self-contained HTML file.
- Focus mode fades everything but the current paragraph; typewriter scrolling
  keeps the current line in the middle of the window.
- LaTeX and Typst documents are edited as source, with a live preview and PDF
  export. Compile problems are marked beside their lines; clicking a mark shows
  its messages there.
- LaTeX compilation supports SyncTeX, multi-file outlines and BibTeX/Biber
  citations. The outline also lists figures, tables, labels and citations, and
  can be folded or limited to a few heading levels. Citation and label
  completions show the entry's author, year and title, or what the label marks.
- The PDF preview offers a dark paper that keeps colours (and optionally
  leaves images untouched), two pages side by side, following the editor as it
  scrolls, and a window of its own for another display.
- To-do notes (`% TODO`, `\todo{…}`, `// TODO`, `<!-- TODO -->`) are listed in
  the sidebar.
- Tabs, workspace-wide search and replace, and a command palette. The file
  tree follows changes made outside Clavis.
- The word count shows an estimated reading time.
- Automatic saving and session restore.

## Installation

Installers are available under
[Releases](https://github.com/ziwangprincex/Clavis/releases/latest): `.exe` for
Windows, `.dmg` for macOS and `.AppImage` for Linux.

On Apple silicon Macs, Clavis is also available through Homebrew:

```bash
brew install --cask ziwangprincex/clavis/clavis
```

Typst is built in. LaTeX requires TeX Live or MacTeX; XeLaTeX is recommended
for CJK text and custom fonts.

## Usage

Open a file or a folder from the toolbar. Most commands are available in the
command palette.

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Command palette | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| Quick Open (files, headings, labels, `:line`) | `Cmd+P` | `Ctrl+P` |
| Compile (LaTeX) | `Cmd+B` | `Ctrl+B` |
| Workspace search | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Export PDF (LaTeX, Typst) / HTML (Markdown) | `Cmd+Shift+E` | `Ctrl+Shift+E` |
| Markdown source view | `Cmd+/` | `Ctrl+/` |
| Bold / italic / link (Markdown) | `Cmd+B` / `Cmd+I` / `Cmd+K` | `Ctrl+B` / `Ctrl+I` / `Ctrl+K` |
| Heading 1–6 / paragraph (Markdown) | `Cmd+1`–`Cmd+6` / `Cmd+0` | `Ctrl+1`–`Ctrl+6` / `Ctrl+0` |
| Write / Split / Read (LaTeX, Typst) | `Cmd+2` / `Cmd+3` / `Cmd+4` | `Ctrl+2` / `Ctrl+3` / `Ctrl+4` |
| Move table row / column (Markdown) | `Cmd+Option+↑↓` / `Cmd+Option+←→` | `Ctrl+Alt+↑↓` / `Ctrl+Alt+←→` |
| Focus mode | `Cmd+Shift+Enter` | `Ctrl+Shift+Enter` |
| Sidebar | `Cmd+Shift+L` | `Ctrl+Shift+L` |

In a Markdown table, `Tab` and `Shift+Tab` move between cells.

Updates are checked in Settings → Updates.

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
