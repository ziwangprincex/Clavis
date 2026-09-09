# Clavis - Handoff

Updated 2026-09-09. This is the one page the next session reads first. It states
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

- Preparing v1.7.0 under the owner's explicit 2026-09-09 request to push and
  publish a new version. This authorizes this release, its installers/updater
  manifest and the associated Homebrew update, not future releases. Version
  metadata matches; notes: `docs/releases/v1.7.0.md`. Follow `RELEASING.md`;
  publication and signature checks are pending, not implied by the version bump.
- v1.6.0 is already public at `d406626` (2026-09-09). Its Release, main CI and
  Homebrew workflows succeeded. Keep the existing tag and release unchanged.
- v1.7.0 includes all post-1.6.0 local source and regression tests, not just the
  latest sidebar edits. Explicit biblatex `backend=bibtex` now takes precedence;
  bibliography entry errors retain source locations and a usable generated bbl
  can continue to PDF output. Font collection has a separate 64 MiB limit.
- PDF citation/reference links use annotations over the text layer. Detached
  preparation no longer drops hit areas; stale clicks cannot navigate a replaced
  surface. Tests cover actual viewer scroll wiring; a real XeLaTeX/biblatex
  sample resolves citations. External links allow only http/https/mailto and
  open via system handlers without a Windows command shell. Details:
  `docs/history/PDF-LINKS-2026-09-09.md`.
- Explicit open folders survive restart; Close folder persists that choice.
  Save stays in the menu/shortcut, folder refresh runs on foreground with a
  command-menu fallback. File and outline trees are nested/foldable; duplicate
  flat project files are hidden when the folder tree covers them. Old sessions
  need the folder opened once (no guessed recovery), noted in release notes.
  `docs/history/SIDEBAR-SESSION-2026-09-09.md`.
- Existing 1.6.0 writing/first-run/sidebar work remains unchanged: compact normal
  editing, centering only in Focus, contextual research/project tools and no
  visible Workspace heading. Details are in `docs/history/WRITING-REFINEMENT-2026-09-09.md`,
  `docs/history/PRODUCT-FLOW-2026-09-09.md`, and `docs/history/SIDEBAR-2026-09-09.md`.
- Fresh v1.7.0 local checks passed: TypeScript, frontend production build,
  820 frontend tests, Rust all-target check, 146 Rust tests (3 optional ignored),
  10 Python guard tests, version/tag validation and working-tree HANDOFF guard.
  Remote exact-tag CI, three-platform packages and public update verification
  still must complete. Native GUI, user-thesis clicks and MacBook Air
  quit/relaunch acceptance remain separate from automated checks.

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
