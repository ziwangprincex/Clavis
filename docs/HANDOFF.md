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

- Preparing v1.6.0 release. Version set in Cargo.toml/Cargo.lock/tauri.conf.json;
  passing `python tools/check_release.py --tag v1.6.0`. Notes:
  `docs/releases/v1.6.0.md`. Release follows `RELEASING.md`; only commit/tag/push
  after the owner authorizes this version.
- Published: v1.5.0 (2026-09-09), all three platforms, updater manifest verified
  with the deployed public key, Homebrew cask updated. `origin/main` carries the
  release. Notes: `docs/releases/v1.5.0.md`.
- The 1.5.0 release folded in the theme convergence (community themes now derive
  a legible syntax palette instead of a hard-coded VS Code fallback), Typst and
  paper previews following the active theme, the history archive, and this page.
- Tree cleanup after 1.5.0: the untracked Chrome-driven UI checks and one-off
  patch scripts under `tools/` are deleted; the two session notes
  `TYPESETTING_WORKFLOW.md` and `UI_PREFERENCES.md` moved to `docs/history/`.
  `tools/` now holds only what CI, the release runbook, and the icon pipeline
  call.
- v1.6.0 content, accumulated locally since 1.5.0:
  - Writing refinement: compact titlebar/sidebar, neutral Paper and Ink
    defaults, normal Write/Split insets fixed (centering is Focus-only). Theme
    cards show only Clavis and theme names; no slogans or palette prose. Closing
    a tab selects its neighbor; problems height reclamps on resize; delayed PDF
    jumps wait for attach without replay; late compile results stay scoped to
    their source document. `docs/history/WRITING-REFINEMENT-2026-09-09.md`.
  - Product-flow pass: first-run actions without a wizard; visible New and PDF
    export; template creation opens the project and preview; LaTeX starter
    checks its environment without blocking drafting. Sidebar and menus are
    contextual, with project/build tools folded. `docs/history/PRODUCT-FLOW-2026-09-09.md`.
  - Sidebar correction: no visible Workspace heading or underlined text tabs;
    compact labelled icons, stable Research entry with an Open folder action,
    one folder header, no empty outline or blank-draft checks.
    `docs/history/SIDEBAR-2026-09-09.md`.
- Tests at last full run: 782 frontend (Vitest), 144 Rust (3 optional ignored),
  10 Python guard tests. Run `npm --prefix web test`, `cargo test`, and
  `python3 -m unittest discover -s tools`.

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
