# Typesetting workflow candidate

Local changes, 2026-09-08. This is a development candidate after the v1.2.0 release commit, not a new release. No remote operation, commit, tag or version change is part of this work.

## Project compilation

Open the project folder to read `clavis.toml`. Both languages use `[project].main` when its extension matches the active language. For example:

```toml
[project]
main = "paper/main.typ"
```

For LaTeX:

```toml
[project]
main = "paper/main.tex"

[latex]
engine = "xelatex"
bibliography = "biber"
```

The Document tools menu can explicitly pin the current file as project main. That choice is recorded on the open project documents and restored with the session; it does not edit the repository's project configuration. The toolbar's engine choice is also a document/session override, not a global setting change.

Main-document precedence: explicit document pin, matching workspace configuration, LaTeX magic root, recognized current project, current file. Engine precedence: explicit override, project configuration, main-document magic program, active-document magic program, global default. `% !TeX root = ../main.tex`, `% !TeX program = xelatex` and `TS-program` are recognized in the first 30 lines. Invalid configured engine names are reported rather than executed.

## Typst

Preview and PDF export use the same root and open-document snapshot. Editing an included chapter no longer needs to compile that chapter as a standalone document when a main is configured/pinned. Unsaved, file-backed documents inside the root are overlaid for both Typst source and raw data reads. External files remain confined to the canonical root. An unsaved scratch document does not inherit the last project's file access.

The preview is divided into pages. Equal page content and source maps are reused, offscreen pages use content visibility, and the scroll container remains mounted. Typst still performs document layout per request; this is not a claim of compiler-level page-incremental layout or a measured speedup.

Compilation failure preserves the previous successful pages for the same document and shows an explicit stale status. Diagnostics include file, range, severity, message and hints. The typesetting-messages disclosure contains clickable source diagnostics and package actions. Refresh rereads disk dependencies. Editing while rendering invalidates delivery of outdated results.

Double-click a page to jump to the nearest mapped source location. Document tools → Jump to preview locates the current source line. Mapping uses laid-out text glyph spans and image/shape spans, including group transforms; it is nearest-location navigation, not exact semantic selection of every generated element. Package-source locations are not opened as local user documents. Stale preview navigation is disabled.

Packages are looked up in the Clavis package cache and standard Typst data/cache directories. Missing `@preview/name:version` imports offer an explicit download confirmation inside preview diagnostics. Compilation never downloads automatically. Downloads use the pinned HTTPS package registry, reject redirects, have timeout/size/count limits, forbid archive links and traversal, check package identity, and stage before publication. Dependencies need their own confirmation. Local custom namespaces are supported through the standard directories. Cached packages work offline. There is no template marketplace or template scaffolding wizard; existing templates can use package imports. Live registry downloads have not been exercised in this local validation.

## LaTeX

Document tools exposes:

- Compile: normal multi-pass engine and bibliography flow.
- Quick preview: one engine pass, with no bibliography pass.
- Clean rebuild: normal compile without restoring auxiliary cache.
- Full build: optional installed `latexmk`, with a separate trust confirmation.
- Stop: the main compile button changes to Stop while busy; it cancels the active process tree and drops queued reruns.

Every build still materializes source into a new temporary directory. Incremental reuse copies only allowlisted auxiliary files, not prior sources or PDFs. Source identity, dependency membership, non-TeX resource content, engine/custom path and bibliography/build mode participate in compatibility checks. Removing dependencies, changing resources or changing the engine invalidates reuse. Clean rebuild bypasses it. Normal compilation retains the existing bibliography passes; caching does not yet optimize away every unchanged bibliography run.

Failed compilation keeps only the matching previous preview. Export and SyncTeX are disabled while updating, after failure, and after source edits make the output stale. A compile that finishes after another edit cannot falsely mark its PDF as current.

Full build starts `latexmk` with `-norc` and optionally loads the trusted workspace's `.latexmkrc`, rejecting an rc symlink outside that workspace. Ordinary TeX shell escape stays disabled. Trusted rc files are executable Perl and can define custom build commands. This mode runs against the temporary source snapshot, not the original working tree. Configurations that depend on original-tree relative scripts, arbitrary generated resources, or custom engine paths should use the existing trusted project-task workflow instead. Index generation was tested with an installed latexmk/pdflatex/makeindex toolchain. Arbitrary glossary/custom-rule configurations remain project-specific.

## Writing assistance

- Hover over a supported formula for a lightweight preview. LaTeX/Markdown use KaTeX, while Typst formulas use an isolated Typst compilation. Document-defined macros/imports are not injected; unsupported formulas simply defer to the full document preview.
- Hover over a citation/reference to see definition context available in the current workspace snapshot. This is source-context lookup, not a full language-server semantic resolver.
- Fold headings and matched LaTeX environments using gutter controls or existing fold shortcuts. Markdown keeps its native parser folding.
- Native spellchecking is disabled on recognized commands, comments, formula/code regions, identifiers and resource paths, while prose stays eligible. Existing writing diagnostics use the same offset-preserving prose mask. This is a conservative syntax filter, not a new dictionary or grammar engine; complex macros and Typst code expressions can require future parser-based refinement.

## Validation and acceptance

Completed on 2026-09-08: 506 frontend tests, TypeScript check, frontend production build, 126 Rust tests, and the separately invoked real latexmk/index test all passed. The default Rust suite skips that one installed-tool test by design. `git diff --check` and release metadata checks passed.

The local macOS app was built successfully at `target/release/bundle/macos/Clavis.app` (14:10 local time). `codesign --verify --deep --strict` passed for its ad-hoc signature. Both Cargo inputs were byte-for-byte identical to their pre-bundle backups after packaging; version remains 1.2.0 and production updater configuration/public key were untouched. No remote release was created. The pre-existing `block v0.1.6` future-compatibility warning and Vite mixed static/dynamic-import warnings are non-blocking and remain.

Run `npm run typecheck`, `npm test`, `cargo test --locked` and `cargo test --locked real_latexmk_builds_document_and_index -- --ignored` (the last requires local TeX tools). The local app build uses `bash build-macos.sh --app-only --skip-install`, which backs up and restores Cargo inputs around Tauri's updater-disabled packaging.

Native acceptance remains separate: verify two unsaved chapters against a fixed main, package confirmation/offline reuse, failure/recovery without scroll loss, forward/reverse source navigation, cancel during bibliography/latexmk, long-document scrolling, and native spelling context-menu behavior. No Chrome preview or Apple developer credentials are required. No measured latency or native visual acceptance is claimed by automated tests.
