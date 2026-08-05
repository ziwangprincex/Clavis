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

### Homebrew (macOS, Apple Silicon)

```bash
brew install --cask ziwangprincex/clavis/clavis
```



### Updates

Clavis checks for updates when it starts. You can also check manually from
**Settings → Updates → Check for Updates**, or the command palette
(`Ctrl/Cmd+Shift+P`) → "Check for Updates…". When there's a new version it asks
first, then downloads and restarts into it.

### LaTeX and Typst

- LaTeX is optional. Install TeX Live or MacTeX if you want it (XeLaTeX handles
  CJK and custom fonts best).
- Typst needs nothing extra; it's built in.

## Project configuration and trust

A workspace may include an optional `clavis.toml` with project metadata and task
definitions. Opening the folder only parses and validates this file; it never runs
a command. If executable tasks are present, Clavis asks before storing trust in
the user configuration directory, separately from the repository.

```toml
[project]
name = "My paper"
main = "paper/main.tex"

[tasks.tables]
command = "Rscript"
args = ["scripts/tables.R"]

[tasks.paper]
command = "latexmk"
args = ["-xelatex", "paper/main.tex"]
depends_on = ["tables"]
```

Trusted tasks appear in the command palette as **Run project task: _name_**.
Dependencies run once in order, stdout/stderr stream into a task panel, and the
running process tree can be stopped. Commands are launched directly with an
argument vector, never through a shell. Optional task fields include:

```toml
[tasks.paper]
command = "quarto"
args = ["render", "paper.qmd"]
cwd = "."
timeout_seconds = 900
depends_on = ["tables"]

[tasks.paper.env]
PAPER_PROFILE = "anonymous"
```

Use **Run Project Doctor** from the command palette to check `clavis.toml`, the
main document, task working directories, trust, and whether task commands are
available. Clavis re-reads both configuration and trust immediately before every
run, so changing a project after it was opened cannot bypass validation.

## Asset references

The Assets sidebar inventories local research assets and traces explicit image
references from LaTeX `\includegraphics`, Typst `#image("...")`, and
Markdown/Quarto image syntax. It reports missing references and unused local
assets, opens an asset, and jumps to a usage. Dynamic paths, remote URLs, and
code/verbatim examples are intentionally excluded.

## CSV / TSV table conversion

Use **Convert CSV / TSV to Table** from the command palette to paste a delimited
table and insert native Markdown/Quarto, LaTeX `booktabs`, or Typst `#table`
syntax. The converter handles quoted CSV cells, tabs, ragged rows, and common
escaping. It is intentionally a text-table converter: it does not yet infer
numeric columns, significance stars, standard errors, or regression-table
semantics.

## Generated artifacts

Declare generated tables, figures, or other files in `clavis.toml` and connect
them to their source files and an existing Project Task:

```toml
[artifacts.baseline_table]
path = "paper/tables/baseline.tex"
kind = "table"
task = "tables"
sources = ["scripts/tables.R", "data/derived/analysis.csv"]
description = "Baseline regression results"
```

The Artifacts sidebar reports `missing`, `stale`, or `ready`, can open existing
artifacts, and runs the declared task. A source missing or newer than the
artifact marks it stale.

## Bibliography browser

The Workspace Bibliography section parses local `.bib` files and supports
multi-token ranked search across citekey, author/editor, year, title, venue, DOI,
keywords, abstract, and entry type. Project citation frequency and recently
inserted keys improve ranking without admitting non-matches. Entries expose
journal/book/publisher, DOI, URL, abstract, keywords, volume/issue/pages, source
location, multi-selection, and language-native insertion for LaTeX, Typst, and
Markdown/Quarto.

## Quarto and Pandoc rendering

`.qmd` files reuse the Markdown editor and Session model but are identified as
Quarto in the status bar. From the command palette, a saved `.qmd` or `.md`
Document can be rendered/exported to HTML, PDF, or DOCX with Quarto or Pandoc.
Rendering requests Workspace Trust on first use, streams through the existing
Task panel, supports Stop/timeout, and opens the newest matching artifact after
success. Project Doctor reports tool versions, `_quarto.yml`, and discovered
`.qmd` files. Quarto/Pandoc must be installed separately.

## References and citations

The Workspace References section builds one index across LaTeX, Typst, BibTeX,
and the research-oriented subset of Markdown/Quarto. It reports duplicate,
missing, unused, unresolved, and ambiguous labels/citations; symbols expand to
their definitions and usage locations.

**Rename Label or Citation Key** previews exact indexed edits, rejects collisions,
unsaved Documents, generated Markdown heading slugs, escaped Typst strings, and
stale files, then updates LaTeX, Typst, Pandoc/Quarto citations, and BibTeX keys
with staged writes and rollback. Bibliography insertion uses native syntax:
`\cite{key}` for LaTeX, `@key` for Typst, and `[@key]` for Markdown/Quarto.

## Workspace search and replace

Use `Ctrl/Cmd+Shift+F` or **Search / Replace in Workspace** from the command
palette. Search supports literal or Rust-regex patterns, case sensitivity, and
clickable file/line results. Replace All requires confirmation and is disabled
for truncated result sets or matching Documents with unsaved edits. Clavis also
refuses replacement if any file changed on disk after the search.

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

