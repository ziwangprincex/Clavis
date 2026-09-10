# Clavis - Handoff

Updated 2026-09-10. This is the one page the next session reads first. It states
what is true now and where the boundaries are. It is not a log: per-session
narratives live in `docs/history/`, release notes in `docs/releases/`, and the
guard only requires that this page still describes the tree after a change.

## What Clavis is

A quiet, native research-writing tool: LaTeX/Typst for papers, Markdown for
notes and drafts, with format-specific tools shown only as needed. Tauri v1, Rust
backend in `src/`, React + TypeScript frontend in `web/`. Real LaTeX
compilation with SyncTeX and BibTeX/Biber, native Typst rendering, PDF reading
with search, save-conflict protection, local version timeline, in-document
formulas. Not an IDE: no plugin host, embedded terminal or AI sidebar. Product
order of work: save protection, long-document performance, Typst reading,
diagnostic guidance, in-document formulas, templates and local history. All six
have shipped implementations; see `docs/WRITER_ROADMAP.md` and
`docs/WRITER_FEATURES.md`.

## State

- v1.7.1 is public at `a1a2ffe` (2026-09-10), following the owner's explicit
  authorization for this release and its Homebrew update, not future releases.
  Main CI, exact-tag Release and Homebrew workflows succeeded. All 11 asset
  hashes, 3 updater signatures and 6 platform entries were verified, including
  unauthenticated public downloads. Homebrew is 1.7.1 with the matching DMG hash.
  Notes: `docs/releases/v1.7.1.md`; verification: `docs/history/RELEASE-1.7.1.md`.
- v1.7.1 includes the complete local bibliography/guidance changes and regression
  tests reviewed on 2026-09-10. Guidance separates missing tools/files, processor
  failure, duplicate labels and additional passes. Source actions require a line;
  Chinese explanations no longer send users into ineffective repeat builds.
- Citation hovers reuse the existing Rust bibliography parser via editor snapshots,
  including unsaved .bib buffers. They show full authors/organizations, title,
  year and source; parenthesized entries and grouped TeX quoting are covered.
  Ref commands are not confused by `cite` in label names. Missing-key wording is
  limited to loaded files. Cache invalidation and stale async results are tested.
- Fresh v1.7.1 local checks pass: 858 frontend tests, 152 Rust tests (3 optional
  ignored), TypeScript, Rust all-target check, frontend production build, 10
  Python guard tests, version/tag validation and working-tree HANDOFF guard.
  Exact-tag CI, three-platform builds and public update checks also passed.
  The prior local updater-disabled candidate built and its ad-hoc signature
  verified; it was not installed and is not a formal update package.
  Details: `docs/history/BIBLIOGRAPHY-REVIEW-2026-09-10.md`.
- v1.7.0 is already public at `3ecc05e` (2026-09-09). Its explicit biblatex backend
  selection, PDF citation links, folder restoration and compact sidebar remain.
  Keep published tags/assets unchanged. Details: `docs/history/PDF-LINKS-2026-09-09.md`
  and `docs/history/SIDEBAR-SESSION-2026-09-09.md`.
- Native GUI/readability acceptance on the owner's thesis and MacBook Air remains
  separate from automated checks. No new architecture or full UI redesign.

## Boundaries the owner set

- Work locally. No Gongfeng, no MCP, no Chrome-preview validation. Deliver by
  `cargo test` and a local macOS build; tests passing is not the same as the
  GUI looking right on the owner's MacBook Air.
- Commit and push only when asked; a tag and formal release only when asked
  separately. `RELEASING.md` is the runbook. No Apple developer credentials or
  notarization work.
- Update notes shown in the app stay short: three bullets, no test counts.
  Long notes once pushed the install button off a 13-inch screen.
- Code style: simple and direct, reuse existing structure, no speculative
  defensive layers. Keep the checks that protect documents (writes, stale async
  results, resource bounds).
- Owner delegated GUI aesthetics. Decide, then show; do not ask per detail.

## Theme system (read before touching any color)

One source of truth: the editor theme (`web/src/theme/themes.ts`). Everything
else derives from it at runtime:

- `chromeTokens()` in `web/src/theme/chromeTokens.ts` writes `--bg`, `--panel`,
  `--text*`, `--border*`, `--accent*`, `--selection`, severities and shadows
  inline on `:root`. `web/src/styles/tokens.css` holds only pre-hydration
  fallbacks and the tokens JS does not set (fonts, radii, motion).
- Editor syntax colors come from `syntaxPalette(spec)`: signature themes ship a
  hand-tuned palette, community themes derive one from their own bg/fg/accent.
  There is no separate VS Code fallback palette anymore.
- Typst pages are white paper under any theme; the reading pane sets
  `--paper-accent` (accent darkened until it reads on white) so selection and
  link highlights stay theme-owned but legible. Markdown "paper" preview does
  the same via `accentTokens(paperAccent)`.
- Component CSS must use tokens. Allowed literals: white paper pages, the
  Windows close-button red in `TitleBar.module.css`, PDF match highlights in
  `PdfViewer.module.css`, and the neutral PDF desk grays there.
- Custom accent/editor colors are user overrides on the same spec, not a second
  theme path. Do not add per-surface color settings; the owner removed the PDF
  surround color for this reason.

## Gotchas

- `cargo check` needs `web/dist` (`generate_context!`); build the frontend first.
- Tauri v1 needs `webkit2gtk-4.0`, so CI pins `ubuntu-22.04`.
- Commands are registered in `main.rs` by canonical module path; `pub use`
  re-exports drop the `__cmd__*` macro.
- Frontend uses `window.__TAURI__` directly; IPC wrappers live in
  `web/src/api/tauri.ts`. Guard UI calls with `hasTauri()`.
- Compare paths with `pathsEqual`/`normalizePath`, never `===` (Windows `\\?\`).
- `release.yml` creates a draft and `tauri-action` uploads into it. Whether the
  draft flips to published on its own has varied (1.4.0 yes, 1.5.0 no). After
  the Windows job finishes, check `gh release view <tag>`; if `isDraft` is
  still true run `gh release edit <tag> --draft=false`. Publishing fires
  `update-homebrew.yml`. Then verify the public `latest.json` and the cask
  checksum.
- `.cm-selectionLayer` sits above content; its fill must stay translucent
  (`selectionFill()` in `web/src/editor/controller.ts`).
- Rust `Settings` has `#[serde(flatten)] extra`; frontend-only settings
  round-trip without touching the struct.

## Open items

- Visual walk-through on the Air at native resolution; the last four releases
  were all triggered by things only the owner's eyes caught.
- Intel macOS build is not produced; only `aarch64`.
- Session restore has no validation of stale `session.json` entries.
- Forward SyncTeX from a subfile is deferred.

## Where the history went

`docs/history/HANDOFF-2026-07-to-2026-09.md` is the full previous log (v1.0.0
through v1.4.0), and the one-off investigation notes moved beside it. Read them
only when a specific past decision needs its reasoning.
