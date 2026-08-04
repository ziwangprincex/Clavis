# Clavis - Handoff (updated 2026-08-04)

A working-state handoff so the next session (or a future you) can pick up cold.
**Current state is in §0 below — it supersedes the now-historical §2 (git) and
§4 (auto-update) notes, which are kept only as a record of how we got here.**

---

## 0. Update - 2026-08-04 (LaTeX completion now backed by the TeXstudio `.cwl` corpus)

**Working state:** on branch **`feat/cwl-completion`** (not `main`). Phase 1 of
the cwl work is committed; Phase 2 (math-mode filtering) is **not started**.
159 frontend tests + 21 Rust tests green, `npm run typecheck` and
`cargo check --all-targets` clean.

### Why this exists

LaTeX ships no machine-readable command index — a package gives you `.sty` macros
and a PDF, nothing structured. So the ~180 hand-written snippets in
`web/src/completions/snippets.ts` could never cover real writing (`\usepackage{siunitx}`
then `\SI` got you nothing). TeXstudio's `.cwl` corpus is the ecosystem's answer;
LaTeX Workshop, Kile and TeXstudio all consume the same files. It yields
**235,956 commands + 8,800 environments** from 4465 files.

### Where the data lives — NOT in git

`resources/cwl/` is **gitignored**. It is fetched at build time by
`tools/fetch-cwl.mjs`, pinned to an upstream commit in `tools/cwl-version.json`
(currently `f5442c5e`), so a given Clavis tag always ships the same command set.

**Consequence to remember:** a fresh clone has no corpus. Run
`node tools/fetch-cwl.mjs` (or just `npm test` / `npm run dev` in `web/`, which
hook it via `pretest`/`predev`). Both `ci.yml` and `release.yml` fetch it after
checkout — **release.yml is the load-bearing one**, since `tauri.conf.json` lists
`resources/cwl/*` under `bundle.resources`; without that step the shipped app has
no completion data.

### Licensing (settled, do not relitigate)

TeXstudio is GPLv3 and `completion/` carries no separate licence. Bundling is
still fine: GPLv3 §5 says inclusion in an *aggregate* does not relicense the
other parts, and Clavis only reads the files as data. LaTeX Workshop (MIT) does
the same thing. Provenance is recorded in the generated
`resources/cwl/LICENSE-cwl.md`. **Clavis itself still has no LICENSE file** —
the user deliberately deferred that. Worth revisiting if Clavis keeps shipping
public releases, since no licence legally means "all rights reserved".

### What was built

- `tools/fetch-cwl.mjs` — streams one repo tarball, keeps `completion/*.cwl`.
  Tar is parsed inline because Windows runners have no dependable `tar`.
- `web/src/completions/cwlParser.ts` — our own whitelist-only parser. Unknown
  shapes are dropped rather than passed through; shell-escape constructs
  (`\write18`, `\openout`, `\catcode`) are rejected, because parsed templates
  become text inserted into the user's document.
- `src/cwl.rs` — serves files **by package name, never by path**, reusing
  `install_package`'s `[A-Za-z0-9._+-]` whitelist. Names come from
  `\usepackage{}` in a user document, i.e. untrusted input. User overrides in
  `<config_dir>/clavis/cwl/` shadow bundled files.
- `web/src/completions/cwlProvider.ts` — lazy, cached, and **never awaits IPC on
  the keystroke path**. Only packages the document loads are read (plus
  `#include:` deps and `latex-document`). `prefetchCwlForDocument` warms the
  cache on tab switch so the first `\` is not half-populated.

### Two behaviour changes to existing code

1. **`engine.ts` dedups by label alone**, not label+insertText. The corpus knows
   `itemize` exists but only as a bare name, while `snippets.ts` has a skeleton
   with `\item` and indentation — same label, different text. Highest boost wins,
   so the richer snippet survives.
2. **`snippets.ts` lost ~130 single-command entries** (`\textbf`, `\frac`, greek,
   operators, symbols). The ~30 multi-line `\begin{...}` skeletons **stayed**:
   cwl environment lines carry only a name (`\begin{align}#\math,array`), so they
   cannot express a body. Markdown/Typst untouched.
   `source.test.ts`'s `\section` assertion was rewritten accordingly — that
   command now comes from the corpus, which needs a Tauri runtime the test lacks.

### Debugging notes worth keeping

- **ustar prefix field.** GitHub tarballs split paths over 100 bytes across the
  header `prefix` (offset 345) and `name`. Reading `name` alone silently lost 11
  deep `tikzlibrary*.cwl` files. `expectFiles` in `cwl-version.json` is now a
  tripwire that fails the fetch loudly instead of shipping a partial library.
- **Verify against the corpus, not the manual.** `cwlCorpus.test.ts` runs the
  parser over all 4465 files and caught three things the TeXstudio manual never
  documents: `\begin{enumerate}\item`, `%<num%:translatable%>`, and
  `pst-bspline.cwl`'s malformed `%)` terminator. Drop rate is 35 lines (0.014%),
  every one malformed upstream.
- **stex cannot give you math mode.** `@codemirror/legacy-modes`' stex tracks it
  internally (`inMathMode`) but the state lives in a closure function pointer
  (`state.f`), unreachable from the syntax tree, and both math and text mode emit
  the same `tag` token. `stexMath` is whole-document-is-math, useless for mixed
  files. Phase 2 must hand-roll the scan.

### Still unverified (manual, off-sandbox)

- **Never run in a real window.** Everything above is test-verified only; the
  sandbox is headless. Needs `tauri dev`: does `\bin` offer `\binom` with
  tab-through placeholders, does `\usepackage{siunitx}` make `\SI` appear (and
  deleting it make `\SI` vanish), does a cold-open document feel instant.
- **CI has not run.** The `fetch-cwl.mjs` step is untested on
  macOS/Linux/Windows runners — tar parsing and path handling could differ.
- **Bundle size / startup.** Corpus is ~10 MB raw, ~1.7 MB compressed (measured
  15.6% gzip on a 17-file sample). Startup should be unaffected because nothing
  is parsed until a package is referenced, but that was never measured on a real
  build.

### Phase 2, not started

Math-mode detection so cwl's `#m` / `#n` classifiers can be honoured (`\sqrt`
only in math, `\textbf` only in text) — the user explicitly asked for this.
Hand-rolled scan, bounded backtracking (≤500 lines, stop at blank line /
`\begin{document}`), defaulting to text when unsure: mis-detecting math hides
`\textbf`, which is worse than showing a few extra math commands. Also deferred:
`#t`/`/env` filtering, `#keyvals:` key/value completion, `L0`–`L5` outline
integration.

---

## 0.1. Update - 2026-08-03 (both pending bodies of work committed + shipped: v1.0.3, v1.0.4)

The two entries immediately below were written while their work was **still
uncommitted on `main`**. That is no longer true — both have since been committed
and released. This entry reconciles the handoff with the actual git history; read
it before the "not yet committed" language in the older entries, which is now
stale.

**Working state:** on `main`, **working tree clean, everything committed and
pushed**. Current version is **1.0.4** in `Cargo.toml`, `Cargo.lock`, and
`tauri.conf.json`. Tags `v1.0.3` and `v1.0.4` exist locally and on `origin`.

### What landed since the handoff was written

- **GUI overhaul → committed as `eb49bfb` ("GUI overhaul"), shipped as
  `006330a` ("Release v1.0.3"), tag `v1.0.3` pushed.** This is the 2026-07-31
  entry below (frameless shell, titlebar, status bar, materials, ratio-based
  splitter, etc.).
- **Completion module → committed as `1fb8039` ("Fix some bugs on Latex"),
  shipped as `b9fee6e` ("Release v1.0.4"), tag `v1.0.4` pushed.** This is the
  two 2026-08-03 entries below (editor-agnostic completion engine + the
  adversarial re-review's 6 bug fixes). The commit message understates it: it is
  the whole `web/src/completions/` module plus its regression suite, not just
  LaTeX bug fixes. `1fb8039` is also the commit that carried the (now-stale)
  "not yet committed" handoff text.
- **README EN + zh-CN updated (`0615844`, `c07b310`).** Both dropped the
  `xattr -cr /Applications/Clavis.app` quarantine-clearing step from the Homebrew
  install block, so the macOS install instruction is now just
  `brew install --cask ziwangprincex/clavis/clavis`. (If that command still
  produces a "damaged" warning on a fresh macOS install, the `xattr` line was
  the fix and removing it was premature — verify on real hardware.)

### Release bumps are pure version changes

`006330a` and `b9fee6e` each touch only the three version locations
(`Cargo.toml`, `Cargo.lock`, `tauri.conf.json`) — no code. All feature work rode
in on the commit *before* each bump (`eb49bfb`, `1fb8039`).

### Still unverified (manual, off-sandbox)

- **Whether the `v1.0.3` / `v1.0.4` GitHub Release drafts were actually
  published** (git only proves the tags were pushed, which triggers the workflow
  and creates *drafts* — §4 explains drafts still require a manual Publish). If a
  draft is unpublished, the `/releases/latest/download/latest.json` updater
  endpoint will not advance and in-app auto-update from 1.0.2 will not offer
  1.0.4. Check `github.com/ziwangprincex/Clavis/releases`.
- **Homebrew cask version.** The `update-homebrew` workflow fires on
  `release: published`; if the releases weren't published, the cask is still at
  1.0.2.
- All the per-entry "verify manually at `tauri dev`" lists below still stand —
  the code shipped, but the sandbox is headless, so GUI feel, splitter drag,
  frameless resize/snap, and the live completion behaviors were never exercised
  on real hardware.

---

## 0. Update - 2026-08-03 (adversarial re-review of the completion module: 6 real bugs)

> **Status update (see the entry above):** this work is now committed as
> `1fb8039` and shipped in **v1.0.4**. The "still uncommitted" phrasing below is
> historical.

A second, independent review of the (still uncommitted) completion work below
found **6 real logic bugs that all 78 tests missed**. All are fixed; the earlier
§0 entry for this date describes the architecture and remains accurate, but its
"logic bugs found and fixed" list was incomplete and two of its claims were
wrong. Corrections are called out below.

**Working state:** `npm --prefix web test` = **97/97** (78 existing + 19 new
regressions), typecheck clean, `npm --prefix web run build` succeeds. Frontend
only; no Rust files changed.

### The bugs, in severity order

1. **`\input` / `\ref` / `\cite` returned nothing for any file not open as a tab
   (severe).** `latexSemanticProvider.ts` defined its own private
   `normalizedPath()` that lower-cased and unified slashes but did **not** strip
   the Windows `\\?\` verbatim prefix. `ProjectFile.absPath` comes from Rust
   `std::fs::canonicalize` (`src/latex/project.rs:163`) and therefore *is*
   `\\?\C:\...`, while `rootAbs` comes from `tab.filePath` as plain `C:\...`.
   The two never compared equal, so `isInsideProject()` rejected every project
   file. Files that also happened to be open as tabs still worked, because
   `EditorPane`'s `byPath` map overwrote the entry with the tab's plain path —
   which made the symptom read as "only completes files I already have open".
   Fixed by deleting the private helper and using the shared `normalizePath`
   from `web/src/files/projectPaths.ts`. This is the **third** time this exact
   class of bug has landed; §6 already warned about it.
2. **Literal `$` inserted a stray backslash.** `snippetToCM6` escaped a literal
   dollar as `\$`, but CodeMirror's `Snippet.parse`
   (`@codemirror/autocomplete/dist/index.cjs:1507`) unescapes **only** `\{` and
   `\}` — never `\$`. Verified by driving the real `snippet()` apply function:
   the markdown `math` snippet inserted `\$E=mc^2\$` and `mathblock` inserted
   `\$\$`. A bare `$` is correct, because CM6 only treats `$` as special before
   `{` or a digit; a literal `${` is now escaped as `$\{`. Pre-existing bug, but
   the previous pass edited this same function without catching it.
3. **File candidates ignored Workspace scoping.** The earlier entry claimed
   no-Project completion is restricted to the Active Document for "labels,
   files, citations, or environments". Labels/citations/environments did go
   through `documents()`, but `fileCandidates()` read
   `request.workspace.documents` directly and `isInsideProject()` returns true
   for everything when `rootPath` is null — so an unrelated open tab leaked into
   `\input{`. It now goes through `documents()` like every other source.
4. **`\begin{align2}` and `\begin{my_env}` fell out of environment completion.**
   The site regex charset was `[A-Za-z*.-]*`, missing digits and underscore, so
   those names were misdetected as the `word` site.
5. **Wrapped argument lists produced a query containing a newline.** For the very
   common formatting `\cite{knuth1984,\nlamport1994}` the query became
   `"\nlam"`, which can never match a key. Segment splitting now treats a line
   break as a separator for both key lists and paths. Also, the optional-argument
   pattern `(?:\[[^\]]*\])*` could not handle one level of nesting, so
   `\cite[p. [3]]{k` was not recognized as a citation at all.
6. **`\end{` rescanned the whole document ~25× per keystroke.**
   `environmentCandidates()` called `openEnvironments()` once for the name list
   and then **again inside `.map()`** for every candidate's `boost`, each call
   re-running `withoutLatexComments()` over the entire prefix. Hoisted to one
   scan: a 228 KB document went from ~79 ms to ~3.7 ms per keystroke, 13 KB from
   ~26 ms to ~0.4 ms.

### Two claims in the earlier entry that were wrong

- It listed no-Project scoping for **files** as done. It was not (bug 3).
- It described the legacy `$10.8` placeholder fix as making "affected LaTeX,
  Typst, and Markdown templates" correct. The digit parsing was right, but the
  markdown math templates were still broken by the separate `\$` escape (bug 2).

### One thing that is NOT a bug (checked, do not "fix" it)

Consuming a trailing `}` in the environment site looks context-blind, but is
correct: the regex requires `\begin{<name>` immediately before the cursor, so a
`}` at the cursor can only be that argument's own brace. Verified index-by-index
against `\newcommand{\x}{\begin{doc}}` — the outer `}` is left alone.

Likewise, `documents()` replacing the active document's snapshot with the live
buffer is deliberate. A `\newenvironment` that exists only in a stale snapshot of
the file currently being typed is correctly absent.

### Files

- `web/src/completions/latexSemanticProvider.ts` — shared `normalizePath`;
  separate `displayPath()` for user-visible text; `fileCandidates()` scoped via
  `documents()`; single `openEnvironments()` scan.
- `web/src/completions/context.ts` — environment charset; newline-aware segment
  splitting; nested optional arguments.
- `web/src/completions/snippets.ts` — literal-`$` handling.
- `web/src/completions/regressions.test.ts` — **new**, 19 tests.

### Why 78 tests missed all of this

The fixtures were idealized: every path was a forward-slash string like
`'C:/paper/main.tex'` (never the `\\?\C:\...` the app actually receives), and
every argument was single-line. The snippet tests asserted on `snippetToCM6`'s
own output instead of what CodeMirror actually inserts. The new tests use real
Windows verbatim paths and drive the real CM6 `snippet()` function.

**Rules that follow:** fixtures for path logic must use `\\?\C:\...` at least
once; anything that produces a CM6 snippet template must be asserted through
`snippet()`, not through our converter's return value.

### Still verify manually in `web/node_modules/.bin/tauri.cmd dev`

Everything above is unit-verified only; the sandbox is headless.

- Open a real multi-file project, and **without opening the sibling files as
  tabs**, confirm `\input{`, `\ref{`, and `\cite{` now offer them. This is bug 1
  and it needs the real Rust collector to reproduce.
- Insert the markdown `math` and `mathblock` snippets; confirm no `\$`.
- `\begin{doc` + immediate Enter: accepts, no stray `}`.
- A wrapped `\cite{a,` newline `b}` list completes on the second line.

---

## 0. Update - 2026-08-03 (completion architecture, LaTeX semantics, Enter behavior audit)

> **Status update (see the top entry):** this work is now committed as `1fb8039`
> and shipped in **v1.0.4**. The "not yet committed" phrasing below is historical.

The built-in completion implementation was upgraded from a static snippet list wired
directly into `EditorController` to a deep, editor-agnostic completion module. This
work is currently on `main` and **not yet committed**.

**Working state:** `npm --prefix web test` = 78/78, typecheck clean,
`npm --prefix web run build` succeeds, and `git diff --check` is clean. No Rust
files changed, so Rust checks were not rerun for this frontend-only pass.

### Architecture

- The external seam is now one request:
  `complete({ language, text, position, explicit, workspace })`.
  Callers do not know about snippets, LaTeX parsing, project files, BibTeX, or a
  future language server.
- `web/src/completions/engine.ts` detects the completion site, invokes providers,
  fault-isolates provider failures, merges candidates, deduplicates them, and ranks
  them. Provider results may be synchronous or asynchronous so a future TexLab
  adapter can be added without changing `EditorController` or the CodeMirror seam.
- Two real adapters exist now:
  - `snippetProvider.ts` for the existing Markdown / LaTeX / Typst snippets.
  - `latexSemanticProvider.ts` for Workspace-aware LaTeX semantics.
- `source.ts` is now only the CodeMirror adapter. `EditorPane` supplies a fresh
  Workspace snapshot assembled from open Documents plus collected Project files.
  Active editor text overrides the older Project snapshot.
- Windows paths are normalized for identity/comparison, but original path casing is
  preserved for displayed and inserted completion text.
- If a future TexLab provider throws, times out, or is unavailable, local snippets
  and Workspace semantic completions continue working instead of the whole request
  rejecting.

### Completion behavior now implemented

- `\begin{doc` offers `\begin{document}` and inserts a complete begin/end snippet.
- Project-declared `\newenvironment` / `\renewenvironment` names are offered for
  `\begin{...}`.
- `\end{...}` ranks the nearest genuinely open environment first.
- `\ref`, `\eqref`, `\pageref`, `\autoref`, `\cref`, and `\Cref` complete labels
  from the active Project.
- `\cite`, `\citep`, `\citet`, `\autocite`, `\parencite`, and `\textcite` complete
  BibTeX keys, including commands with multiple optional arguments such as
  `\cite[see][p. 3]{...}`.
- File completion is command-specific:
  - `\input`, `\include`, `\subfile`: `.tex` only, with the extension omitted.
  - `\includegraphics`: image/PDF/SVG/EPS files only.
  - `\bibliography`: `.bib` files with the extension omitted.
  - `\addbibresource`: `.bib` files with the extension preserved.
- File arguments containing spaces are replaced as one path rather than being split
  at the final space.
- With an active Project, semantic candidates are restricted to that Project root.
  Without a Project, semantic completion is restricted to the Active Document so
  unrelated open tabs cannot leak labels, files, citations, or environments.

### Logic bugs found and fixed during adversarial review

> **Superseded in part.** The 2026-08-03 re-review section above found 6 further
> bugs and corrects two claims in this list: no-Project scoping did **not** cover
> file candidates, and the `$10.8` fix did not make the markdown math templates
> correct (a separate `\$` escape bug survived). Read that section first.

- **Enter root cause was CodeMirror's interaction delay, not keymap order.**
  `autocompletion()` already installs its completion keymap at `Prec.highest`.
  CodeMirror's default `interactionDelay: 75` makes `acceptCompletion` return false
  during the first 75 ms after the popup opens, so a fast Enter falls through to the
  normal newline command. Both completion configurations now use
  `interactionDelay: 0`. The manually duplicated `completionKeymap` was removed.
- `closeBrackets()` may already have inserted the closing `}` while typing
  `\begin{doc}`. Environment completion now consumes that brace so accepting a
  snippet cannot leave an extra trailing `}`.
- Project file suggestions were previously not filtered by receiving command and
  could mix `.tex`, images, and `.bib`; they are now command-specific.
- All open tabs were previously candidates, which leaked files and semantic symbols
  across Projects. Project and no-Project scoping are now explicit.
- Traditional `\bibliography` and biblatex `\addbibresource` now follow their
  different `.bib` extension conventions.
- LaTeX comments are stripped before indexing labels, declared environments, and
  open-environment stacks. Commented-out commands no longer create ghost candidates;
  escaped `\%` remains content.
- The legacy snippet converter incorrectly parsed `$10.8` as field 10 with default
  `.8`. Legacy fields are single-digit, so `$10.8`, `$11em`, and `$32026-01-01` now
  correctly become field 1/default `0.8`, field 1/default `1em`, and field 3/default
  `2026-01-01`. This fixes affected LaTeX, Typst, and Markdown templates.

### Files

New completion module and tests:

- `web/src/completions/types.ts`
- `web/src/completions/context.ts`
- `web/src/completions/engine.ts`
- `web/src/completions/snippetProvider.ts`
- `web/src/completions/latexSemanticProvider.ts`
- `web/src/completions/source.ts`
- `web/src/completions/source.test.ts`
- `web/src/completions/engine.test.ts`
- `web/src/completions/audit.test.ts`
- `web/src/editor/keymaps.ts`
- `web/src/editor/keymaps.test.ts`

Edited:

- `web/src/completions/snippets.ts`
- `web/src/editor/controller.ts`
- `web/src/components/EditorPane.tsx`

### Verification and manual follow-up

Automated verification completed:

- `npm --prefix web run typecheck` - clean.
- `npm --prefix web test` - 78/78.
- `npm --prefix web run build` - succeeds.
- `git diff --check` - clean.

Still verify manually in `web/node_modules/.bin/tauri.cmd dev`:

- Type `\begin{doc` and immediately press Enter. It should accept the selected
  completion, not insert a newline, and must not leave an extra `}`.
- Verify `\cite{`, `\ref{`, custom environments, and `\end{` against a real
  multi-file Project.
- Verify `\input{` and `\includegraphics{` show only appropriate file types,
  including paths containing spaces.
- Switch between unrelated Projects and confirm semantic candidates never leak.

### Suggested skills for the next session

- `diagnosing-bugs` for any remaining completion interaction or timing issue.
- `codebase-design` when adding a TexLab adapter or changing the provider seam.
- `tdd` if the next step is the Rust JSON-RPC/TexLab process bridge.

### Watch-outs

- Do not add `completionKeymap` manually to the normal editor keymap. CodeMirror's
  `autocompletion()` already installs it at highest precedence.
- Keep `interactionDelay: 0` in both the initial completion compartment and the
  `setLanguage()` reconfiguration path.
- Keep provider failures isolated; TexLab availability must never disable local
  completion.
- Do not use normalized/lower-cased paths as user-visible insertion text.
- Regex-based local semantics intentionally cover fast common cases, not full TeX
  parsing. Package-aware commands, diagnostics, hover, and richer context belong in
  the future TexLab provider rather than continued growth of ad-hoc regexes.

---

## 0. Update — 2026-07-31 (GUI overhaul: frameless shell, titlebar, status bar, materials)

Big cosmetic + structural pass on the Windows GUI. The base perception ("GUI looks
bad") was mostly three concrete implementation defects, plus a pile of polish. All
five stages of the plan landed together on this branch.

> **Status update (see the top entry):** this work is now committed as `eb49bfb`
> and shipped in **v1.0.3**. The "not yet committed" phrasing below is historical.

**Working state:** implemented on `main`, not yet committed. `npm --prefix web test`
= 56/56, typecheck clean, `cargo check` + `cargo test` (18/18) clean.

### What changed

- **Frameless window on Windows only** via new `tauri.windows.conf.json` (deep-merges
  over `tauri.conf.json` at build time). macOS is untouched and still gets traffic
  lights + the standard system menu. Web docs claimed frameless breaks resize / snap /
  drop shadow — verified against vendored tao 0.16.11 source, all false except the
  shadow.
  - Resize on all 8 edges/corners: tao handles `WM_NCHITTEST` at
    `platform_impl/windows/event_loop.rs:2094` → `hit_test()` in
    `platform_impl/windows/window.rs:1324` with `BORDERLESS_RESIZE_INSET = 5`px
    DPI-scaled.
  - Aero Snap / Win+Arrow / drag-to-top: `to_window_styles()`
    (`window_state.rs:228`) keeps `WS_CAPTION|WS_SYSMENU|WS_SIZEBOX` even
    undecorated, and `drag_window()` posts a real `WM_NCLBUTTONDOWN`/`HTCAPTION`.
  - Maximized window doesn't cover the taskbar: corrected in `WM_NCCALCSIZE`
    (`event_loop.rs:2043`).
  - Drop shadow: `Window::hwnd()` is exposed by Tauri v1, so `src/main.rs` gains a
    `.setup()` hook calling `DwmExtendFrameIntoClientArea` with a 1px top margin
    (`restore_undecorated_shadow`). Same technique as `tauri-plugin-window-shadows`.
    Errors are ignored so a missing shadow never blocks startup.
- **Cargo features vs allowlist lockstep** — critical to know: `tauri-build` at
  `tauri-build-1.5.6/src/allowlist.rs:69` **hard-errors at build time** if the
  Cargo.toml `tauri` features and the tauri.conf.json allowlist disagree. Both were
  updated together (`window-minimize`, `-maximize`, `-unmaximize`, `-close` and their
  allowlist keys). `__toggleMaximize` (double-click drag region) needs both
  `window_maximize` AND `window_unmaximize` cfgs — no `toggle-maximize` feature
  exists. `isMaximized` is a getter and NOT gated — do not add it to the allowlist.
- **Custom TitleBar** at `web/src/components/TitleBar.tsx` — 40px, one drag region on
  the root only (Tauri's `data-tauri-drag-region` uses an **exact `e.target` check**,
  so children are automatically non-draggable; the 8 old `-webkit-app-region: no-drag`
  rules in Toolbar.module.css were Electron-only dead CSS and are gone). Windows caption
  buttons at 46×32, `#c42b1c` close-hover. Restore/maximize glyph reflects
  `isMaximized()`, refreshed on mount and on `tauri://resize`. On macOS the buttons
  render nothing (traffic lights come from the decorated window) and the padding-left
  gutter for them lives in `TitleBar.module.css`. Every call is `hasTauri()`-guarded —
  the HANDOFF gotcha about unguarded `tauri()` throws was respected.
- **`web/src/api/tauri.ts`** grew an `appWindow` wrapper (minimize, toggleMaximize,
  close, isMaximized, onResized) matching the existing typed-`TauriGlobal` shape.
- **Bottom status bar** at `web/src/components/StatusBar.tsx`, 24px, last child of
  `.app`. Left: transient status message (severity dot; pulses when a compile is
  in flight). Right: `Ln N, Col N` · language · `<n> words · <n> chars` · error-count
  chip (LaTeX only, only when non-zero). Clicking the chip toggles the problems panel.
- **Status text moved to a store** (`web/src/store/status.ts`, `useStatusStore`).
  Previously `App.tsx` held local `statusText`/`statusKind` state that only Toolbar
  read; now the StatusBar consumes it, and the ~10 async helpers write via a single
  `setStatus(text, kind)` call instead of the old two-call `setStatusText`/`setStatusKind`
  pair.
- **Live cursor position** wired using the **existing-but-unused** `onCursor` option
  in `web/src/editor/controller.ts:324` (fired from the `updateListener` on
  `update.selectionSet` — was already there, just never plumbed). Controller gains
  `cursorLineCol()`. `EditorPane` publishes to a new `useCursorStore`.
- **Word/char count** in `web/src/editor/stats.ts` + 7 unit tests. Debounced ~250ms
  via `requestIdleCallback` (fallback: setTimeout) so long docs don't jank on
  keystroke — the tabs store's `content` still updates undebounced, but the count
  hook watches a debounced snapshot.
- **Problems panel now conditional** — only rendered when `lang === 'latex' &&
  settings.problems_panel_open`. Split the log panel + its splitter from the
  unconditional flex slot in App.tsx that occupied ~220px of empty height in
  Markdown/Typst.
- **Problems panel needs TWO ways to reopen (self-review catch).** First cut made the
  status-bar chip the only toggle, and the chip only rendered when
  `errorCount > 0`. A clean LaTeX compile + a previously-closed panel = the panel,
  the chip, and any route back all disappear — and `problems_panel_open: false` is
  **persisted to disk**, so it survives restart and reads as "the log panel is
  permanently broken". It also hid the raw compile log, which is the only thing to
  read when a compile fails in a way the diagnostic parser missed. Fixed two ways:
  a `view.toggleProblems` command-palette entry (the real safety net) and the chip
  now also renders at zero count as "No issues". **Any future
  persisted-and-hidden UI toggle needs a palette entry — this class of bug is a
  one-way door.**
- **Materials: the frosted-glass design was removed, not fixed.** `appTheme.ts` used
  to overwrite `--panel` with an opaque `mix()` inline, defeating every
  `backdrop-filter: blur()` in the CSS. First attempt was to make `--panel` genuinely
  translucent so the blur would work — then an audit showed **why** it never mattered:
  in this layout the titlebar / toolbar / status bar / PDF toolbar are all
  `flex: none` siblings **stacked above** the editor and preview, never overlapping
  them. There is nothing behind them to blur. So the chrome now commits to flat
  opaque surfaces:
  - `--panel` and `--panel-solid` are deliberately the **same opaque color** (both in
    `appTheme.ts` and the `tokens.css` fallbacks).
  - The inert `backdrop-filter` on the PdfViewer toolbar is gone (it cost a
    compositing layer for zero pixels of effect).
  - `--material-edge` was **deleted** — it was defined in 3 places and consumed
    nowhere after the titlebar rewrite. That stray inset highlight with no material
    behind it was one of the original "looks bad" symptoms.
  - The only genuine blurs left are the CommandPalette / SettingsDialog **backdrops**,
    which really do overlay content. `prefers-reduced-transparency` handling moved
    into those two CSS modules (CSS-module class names are hashed, so the old
    `global.css` `:root { --panel: var(--panel-solid) }` rule could never have
    targeted them — and is now redundant anyway).
  - **Do not reintroduce a translucent `--panel`** without first making a bar
    actually overlap scrollable content.
- **`--panel` has no direct consumers left.** Everything that paints a surface uses
  `--panel-solid` (chrome bars, `kbd`, symbol cells, panel headers, preview
  `pre`/`code`). `--panel` is kept only as the paired fallback so the two can never
  drift apart silently.
- **Preview paper toggle:** new `preview_paper: 'light' | 'match'` setting (Settings
  → Preview). Default `'light'` preserves the historical bright paper surface;
  `'match'` derives the preview surface from the app theme (no more dark-editor →
  white-page brightness cliff). Applied via a `.paperLight` modifier class in
  PreviewPane that shadows the color tokens locally — note it must define **both**
  `--panel` and `--panel-solid` so `match` mode picks up theme panel colors for
  code blocks instead of a stale light value.
- **Layout polish:**
  - Splitters became transparent 7px hit strips with a 1px hairline (`::before`
    accents on hover/drag). No more accent-blue 4px bars.
  - Collapsed the triple border above the log (removed border-top from `.logArea`
    and `.root` of LogPanel).
  - Sidebar clamp fix: `usePaneLayout.ts` was clamping to 160 while the CSS
    `min-width` was 200 — a real 160–200px dead zone that persisted wrong values.
    Both agree on 200 now.
- **Editor/preview split is now a RATIO, not a pixel width (user-reported bug).**
  Report: "the right-hand pane often locks itself to a fixed position and I can't
  resize it." Two real causes:
  1. `.editorPane` got `flex: 0 0 <px>` — a **hard pin** — while `.previewPane` kept
     `flex: 1`. So after a single splitter drag the editor froze at an absolute pixel
     width and the preview absorbed 100% of every later window resize. The split
     never rebalanced again.
  2. `dragEditor` measured against `workAreaRef` (`.workArea`, the column that also
     holds the tab bar and problems panel) rather than the row that actually contains
     editor | splitter | preview, so the clamp math used the wrong box.
  Fix: new `editorRowRef` on `.editorRow` for correct measurement; both panes now get
  `flex: <ratio> 1 0%` (editor `r`, preview `1-r`) so they always divide the row
  proportionally and keep rebalancing on resize. The drag clamps in px via
  `MIN_PANE_PX = 220`, then stores a ratio.
  - Setting renamed: `pane_editor_width` (px) → **`pane_editor_ratio`** (0..1).
  - `.editorPane` / `.previewPane` keep `min-width: 0` **deliberately** — a hard
    `min-width` there can overflow the row, since the sidebar is `flex-shrink: 0` and
    may be up to 640px wide in a 720px-min window. The usability floor is enforced
    during the drag, not in CSS.
  - **Migration:** `pane_editor_width` is a *typed field on the Rust `Settings`
    struct* (`src/settings.rs:46`), NOT part of the `serde(flatten)` extras, so it
    keeps arriving from disk. `migrateSettings()` in `web/src/store/settings.ts`
    converts a legacy px value once (nominal 1200px row, clamped 0.15–0.85) so
    existing installs land near their previous split instead of snapping to 50/50.
    5 tests in `web/src/store/settings.test.ts`.
  - The Rust `pane_editor_width` field is now unused but harmless; dropping it would
    require a Rust change and buys nothing.
- **Splitter snap-back: the ACTUAL root cause (two follow-up bugs).** The ratio change
  above was necessary but did NOT fix the reported symptom — "I drag left to make the
  right pane bigger, but it jumps back and pins itself." Two compounding bugs, both in
  the drag plumbing rather than the layout:
  1. **Stale drag closures.** `Splitter` installs its mousemove/mouseup listeners once
     per mousedown, inside a `useCallback` that closes over the handler props it had at
     that instant. But the parent re-renders on *every* mousemove (pane size is React
     state), so by mouseup the captured `onDragEnd` is a stale identity — and
     `endEditorDrag` read the `editorRatio` **React state**, i.e. the value from
     *before* the drag. So the drag persisted the pre-drag ratio.
  2. **Seed-effect feedback loop.** The init effect depended on the persisted pane
     settings. Drag end → `patchAndSave` → settings change → effect re-runs → `set*`
     pushes the (stale, pre-drag) value back into state → the splitter visibly snaps
     back and appears "pinned".
  Fixes:
  - `usePaneLayout` mirrors every live pane size into a ref
    (`sidebarWidthRef` / `editorRatioRef` / `logHeightRef`) via `apply*` setters; all
    `end*Drag` handlers persist from the **refs**, never from React state.
  - The seed effect now runs **exactly once**, guarded by `seededRef` plus a
    `useSettingsStore.getState().loaded` check, so it can never fight a live drag.
  - `Splitter` keeps `onDrag`/`onDragStart`/`onDragEnd` in refs that are refreshed on
    every render, and the document listeners call `onDragRef.current(...)`. Also added:
    primary-button-only (`e.button !== 0` bails), a `window blur` fallback so a drag
    can't stay armed if focus leaves mid-drag, an unmount cleanup that restores the
    `document.body` cursor/user-select overrides (the splitter can unmount mid-drag
    when the problems panel is toggled), and `aria-orientation`.
  **Lesson: any handler passed into a listener that outlives a render must be read
  through a ref.** Persisting UI state from a `useCallback`-captured closure is a
  silent correctness bug here — it type-checks and the drag *looks* live, because the
  mousemove path used fresh state while only the commit path was stale.
  - Removed nested sidebar scroll (`.sectionBody { max-height: 340px; overflow-y:
    auto }` is gone; the sidebar has a single scroll container).
  - `▾`/`▸` in Sidebar (via `IconChevronDown` rotated), `●`/`×` in Tabs (via new
    `IconDot`/`IconClose`), and folder-tree `×` all became SVG icons.
    `IconChevronDown` was defined but unused before — reused it. Added
    `IconWinMinimize`/`Maximize`/`Restore`/`Close` for the titlebar.
  - Tokenized motion: hardcoded `0.06s`/`0.1s`/`0.12s`/`0.15s`/`0.18s`/`0.2s`
    durations replaced with `--dur` / `--dur-fast` / `--dur-slow`.
  - Auto-compile switch is now `--accent`, not `--ok` (green in a blue UI).
  - `font-style: italic` deleted from ~10 empty/notice states; `(no tabs)` →
    `No open documents`, `(untitled)` → `Untitled`, `(none)` → `No folder`.
- **Dead code removed:** `ui_theme` (settings.ts) — `appTheme.ts` no longer reads it;
  8× `-webkit-app-region: no-drag` (Toolbar.module.css) — Electron-only.

### Files touched

New: `tauri.windows.conf.json`, `web/src/components/TitleBar.tsx` + `.module.css`,
`web/src/components/StatusBar.tsx` + `.module.css`, `web/src/store/status.ts`,
`web/src/editor/stats.ts` + `stats.test.ts`.

Notable edits: `tauri.conf.json` (allowlist), `Cargo.toml` (features +
`[target.'cfg(windows)'.dependencies] windows-sys`), `src/main.rs`
(setup hook + `restore_undecorated_shadow`), `web/src/api/tauri.ts`,
`web/src/App.tsx`, `web/src/components/Toolbar.tsx` (+ css), `web/src/components/Tabs.tsx`
(+ css), `web/src/components/Sidebar.tsx` (+ css), `web/src/components/Splitter.module.css`,
`web/src/components/FolderTreeSection.tsx` (+ css), `web/src/components/PreviewPane.tsx`
(+ css), `web/src/components/SettingsDialog.tsx`, `web/src/components/EditorPane.tsx`,
`web/src/components/icons.tsx`, `web/src/hooks/usePaneLayout.ts`,
`web/src/store/settings.ts`, `web/src/store/index.ts`, `web/src/theme/appTheme.ts`,
`web/src/styles/tokens.css`, `web/src/styles/global.css`, `web/src/App.module.css`.

### Verification done

- `npm --prefix web run typecheck` — clean.
- `npm --prefix web test` — 56/56 (7 new stats tests + 5 settings-migration tests).
- `npm --prefix web run build` — succeeds.
- `cargo check` — clean.
- `cargo test` — 18/18.

### Still to do (manual, on real hardware)

Sandbox is headless. Verify at `web/node_modules/.bin/tauri.cmd dev`:
- One titlebar (no native strip above ours). Drag the titlebar. Double-click it →
  maximize/restore. Restore glyph flips.
- All 8 resize edges/corners.
- Win+Left/Right snap. Drag to top → maximize. Taskbar isn't covered when maximized.
- Drop shadow around the window.
- Cursor `Ln/Col` in status bar tracks selection changes.
- Word count keeps up in a long `.tex` without keystroke jank.
- Problems panel gone in Markdown / Typst; appears in LaTeX and can be toggled via
  the status-bar chip.
- Settings → Preview → "Preview surface" switch: `light` gives white paper, `match`
  derives from theme.

### Watch-outs for the next session

- `tauri-build` allowlist ↔ Cargo features check is a **build-time hard fail**; keep
  them in sync when adding window APIs.
- `data-tauri-drag-region` in Tauri v1 uses an exact `e.target` check; DO NOT try to
  add a `.closest()`-style opt-out or re-introduce `-webkit-app-region` — children
  are already auto-excluded and those attrs are dead CSS in Tauri.
- Frameless `decorations: false` is Windows-scoped via `tauri.windows.conf.json`.
  If macOS is ever re-enabled for frameless, the drop-shadow trick is Windows-only
  (guard with `#[cfg(windows)]`, already done).
- `--panel` and `--panel-solid` are the SAME opaque color on purpose. Don't make
  `--panel` translucent again unless you first make a chrome bar genuinely overlap
  scrollable content — otherwise `backdrop-filter` has nothing to blur (that was the
  original bug). Everything that paints a surface should use `--panel-solid`.
- **Drag/resize handlers must be read through refs.** `Splitter` installs document
  listeners that outlive the render they were created in, and the parent re-renders on
  every mousemove. Reading React state (or a `useCallback`-captured prop) in a
  drag-end handler persists a **pre-drag** value — the drag looks live but commits the
  wrong number, and if a `useEffect` also re-seeds from that setting you get a visible
  snap-back. Both `Splitter` and `usePaneLayout` now mirror through refs; keep it that
  way, and keep the pane-seeding effect one-shot (`seededRef`).
- `preview_paper`, `problems_panel_open` are frontend-only settings; they persist
  via Rust's `#[serde(flatten)] extra` on `Settings`. No Rust change was needed.

---

## 0. Update - 2026-07-30 (v1.0.2 published and distribution verified)

- GitHub Release `v1.0.2` is published and is the public latest release.
- The public updater manifest at `/releases/latest/download/latest.json` reports
  version `1.0.2` and contains signed artifacts for Windows x86_64, macOS ARM64,
  and Linux x86_64. Existing `1.0.1` installs can now discover `1.0.2`.
- The Homebrew automation completed: `homebrew-clavis/Casks/clavis.rb` now has
  version `1.0.2` and DMG SHA-256
  `27eac0a4ba5c9db9f857e9e36078c94504d6ccf3697be1d03ab52f98b4031e08`.
- Distribution status is complete. Remaining verification is optional end-user
  smoke testing of an actual in-app update and `brew upgrade --cask clavis`.

---

## 0. Update - 2026-07-30 (v1.0.2 tag correction)

- The first `v1.0.2` tag was accidentally created on commit `40b61bf`, before
  the version bump, so Release preflight correctly rejected it: the tag was
  `v1.0.2` while `Cargo.toml`, `Cargo.lock`, and `tauri.conf.json` were `1.0.1`.
- The actual version bump is commit `6095d27` (`Release v1.0.2`), where all three
  version locations are `1.0.2`.
- The local and remote `v1.0.2` tag were force-moved to full commit
  `6095d276a5cf9a673ded6b9edff8554ab1c82299`. `git ls-remote` confirms the
  remote tag now resolves to that exact commit.
- Do not move the tag again. The corrected tag push should trigger a fresh
  Release workflow. Review that run in GitHub Actions, then publish its draft
  only after all platform assets and `latest.json` are present.

---

## 0. Update - 2026-07-30 (release guardrails and repository hygiene)

**Working state:** implementation is committed on `main`; release version bump
is commit `6095d27` and the corrected `v1.0.2` tag points to it.

- Added `tools/check_release.py`: CI/release preflight now requires the Clavis
  versions in `Cargo.toml`, `Cargo.lock`, and `tauri.conf.json` to be valid SemVer
  and identical. On tag builds, the tag must equal `v<version>`.
- Added a Release workflow `preflight` job. A mismatched tag/version now fails
  before GitHub creates a draft Release or starts platform builds.
- Added `tools/set_version.py` and guarded `tools/release.ps1`. The script requires
  clean `main`, updates all three version locations without reformatting config,
  runs checks by default, and prints commit/tag/push commands rather than pushing
  automatically.
- Added `tools/check_handoff.py` and wired it into CI. Any repository change
  other than `HANDOFF.md` itself must include a `HANDOFF.md` update in the same
  push or PR, turning the project rule into an enforced check.
- Added `.gitattributes` with repository-wide LF normalization and explicit
  binary asset patterns, eliminating recurring CRLF diff noise. Python cache
  artifacts from the new tools are now ignored in `.gitignore`.
- Updated `RELEASING.md` with the guarded release flow and clarified that a normal
  `main` push runs CI only; a matching `v*` tag creates a draft Release that must
  still be published manually.

**Validation for these guardrails:**

- Release metadata accepts the current `1.0.2` / `v1.0.2` pair and rejects a
  mismatched tag.
- The version updater was exercised against isolated copies and changed only the
  three intended version fields without reformatting `tauri.conf.json`.
- Handoff watched-path logic and rejection behavior were exercised locally.
- Both workflow files parse as YAML; all Python tools compile; `release.ps1`
  parses successfully and refuses the current dirty working tree as designed.

---

## 0. Update - 2026-07-30 (Workspace Session Snapshot hardening)

**Working state:** committed and pushed on `main`; included in the corrected
`v1.0.2` release tag.

- **Workspace recovery now goes through a validated Session Snapshot module.**
  New `web/src/files/sessionModel.ts` owns encoding, decoding, migration,
  per-Document validation, path-aware deduplication, restore prioritization, and
  the 50-Document restore cap. `web/src/files/session.ts` restores the Workspace
  atomically after validation instead of adding tabs one at a time.
- **Session schema is v2 and remains compatible with v1.** A damaged Document is
  skipped without discarding the rest of the snapshot. Runtime-only state such
  as `latexWorkdirToken` is no longer persisted.
- **Duplicate file-backed Documents are collapsed by normalized path.** The last
  in-memory version wins. Scratch Documents are all retained. Above the cap, the
  Active Document is retained first, followed by the newest dirty Documents and
  then the newest remaining Documents.
- **File-backed identity is repaired during restore.** Title and language are
  derived from the path, preventing stale Session data from compiling Markdown
  as Typst. New `web/src/files/documentIdentity.ts` is shared by restore,
  file-open, and save-as paths.
- **Domain language is recorded in `CONTEXT.md`.** It defines Document,
  Workspace, Project, Session Snapshot, Active Document, and Scratch Document.
- **Tests added:** `web/src/files/sessionModel.test.ts` has 6 cases covering
  corrupt snapshots, per-Document degradation, Windows path deduplication,
  title/language repair, restore prioritization and capping, v1 compatibility,
  and persistent-field filtering.

**Verification completed:**

- `npm --prefix web test` - 44/44 tests pass.
- `npm --prefix web run typecheck` - passes.
- `npm --prefix web run build` - passes.
- `cargo check` - passes.
- `cargo test` - 18/18 tests pass.
- `git diff --check` - passes.

**Still to do:**

- Run the desktop app on real hardware and manually verify restart/crash recovery.
- Other architecture-review candidates (typed Tauri command contracts, App
  workflow deepening, and slimming `src/main.rs`) were not part of this change.

---

## 0. Update — 2026-07-13 (theme unify, macOS signing, updater key, v1.0.1 shipped, Homebrew)

**Git/release state now:** on **`main`**, working tree clean, everything below
committed + pushed, CI green. **v1.0.1 is released AND published** on GitHub, so
the `/releases/latest/` updater endpoint resolves. This supersedes §2/§4 below.

- **Theme system unified — one theme drives the whole UI.** `settings.editor_theme`
  (may be `'auto'` = follow OS) is the single source of truth. New
  `web/src/theme/appTheme.ts` derives every chrome CSS token (`--bg`, `--panel`,
  `--text`, `--border`, `--selection`, `--accent`, …) from the chosen `ThemeSpec`
  so toolbar/sidebar/preview match the editor. `ui_theme` is now unused; the theme
  picker moved to Settings → **Appearance**. `useAppTheme` + `EditorPane` share
  `useResolvedThemeSpec()`.
- **Invisible-text bug fixed.** Editor dropped the light-only `defaultHighlightStyle`;
  `controller.ts` now picks a dark/light `HighlightStyle` by `spec.dark` (added dep
  `@lezer/highlight` in `web/package.json`).
- **macOS "damaged" fix.** `tauri.conf.json → macOS.signingIdentity: "-"` (ad-hoc
  sign; required for arm64 to launch). **Not notarized** — paid Apple Developer
  deferred by choice. Distribution: run `xattr -cr /Applications/Clavis.app` once
  (documented in both READMEs + the cask `caveats`).
- **Updater key rotated + now matched.** Old `pubkey` was corrupt (stray `%`) and
  didn't match the private key → the `does not match` warning. Generated a fresh
  pair: new `pubkey` in `tauri.conf.json`, new `TAURI_PRIVATE_KEY` /
  `TAURI_KEY_PASSWORD` secrets. Verified v1.0.1 `latest.json` signatures use it.
- **Release workflow fixed (matrix race).** Letting each matrix job create its own
  release produced **duplicate drafts with split `latest.json`**. `release.yml` now
  has a `create-release` job that makes ONE draft; all platforms upload via
  `releaseId` → a single complete `latest.json`. checkout/setup-node bumped to `@v5`.
- **Homebrew tap.** `ziwangprincex/homebrew-clavis` (Cask).
  `.github/workflows/update-homebrew.yml` fires on `release: published`, hashes the
  DMG, and pushes a canonical `Casks/clavis.rb`. Needs secret **`HOMEBREW_TAP_TOKEN`**
  = fine-grained PAT with **Contents: Read and write** on the tap repo. Maintained
  source + notes live in `packaging/homebrew/`. Install:
  `brew install --cask ziwangprincex/clavis/clavis` then `xattr -cr /Applications/Clavis.app`.

---

## 1. What Clavis is

Tauri **v1** desktop editor for **Markdown / LaTeX / Typst**. Rust backend
(`src/`), React + TypeScript frontend (`web/`). Real LaTeX engine compilation,
SyncTeX, BibTeX/Biber, Typst rendering, PDF preview with search.

- **Launch dev:** `web/node_modules/.bin/tauri.cmd dev` (there is **no** root
  `package.json`; the tauri CLI lives under `web/node_modules`). If it errors
  `Port 5173 in use`, a stale Vite is running — `npx kill-port 5173` first.
- **There is no `tauri check` command.** To verify: `cargo check` +
  `npm --prefix web run typecheck` + `npm --prefix web exec tauri info`.

---

## 2. Git state — READ FIRST

- Branch: **`p0-guardrails`** (name is historical; it now contains P0–P3 work).
- Working tree is **clean** — this whole session is committed.
- Latest commits (all pushed, **CI green**):
  - `Set updater public key`
  - `Multi-file LaTeX jumps, GUI/apple-design polish, tabbed settings, 14 review-fixes`
  - `Add Tauri auto-updater: config, release CI, Check-for-Updates UI`
  - (earlier) `cd20c05` CI pin, `a784395` latex split, `9c37ee9` shell-escape.
- **Tag `v1.0.0` pushed** → Release workflow building (see §4).
- **Not yet merged to `main`** — `p0-guardrails` is ahead. Open a PR / merge when
  ready to consolidate (optional).

### Tooling artifacts are gitignored
`.agents/`, `.claude/`, `skills-lock.json` are Claude Code / skill tooling (not
project source) and are in `.gitignore` — they stayed out of the commits. Good.

### Still worth doing (not done)
- **`.gitattributes`** with `* text=auto eol=lf` — Windows CRLF warnings inflate
  diff stats; this fixes it permanently.

## 3. What was done this session (all verified: typecheck / build / cargo / tests green)

**Tests now: 38 frontend (Vitest) + 18 Rust.** CI is green on GitHub.

- **P0/P1/P2 (from an earlier code review):** shell-escape hardening, CI
  workflow, split `src/latex.rs` → `src/latex/` module tree, front-end Vitest
  net, App.tsx → hooks, PdfViewer → `usePdfSearch`, FS-scope hardening,
  `docs/SECURITY_MODEL.md`.
- **Multi-file LaTeX (P3):** F1 reverse-SyncTeX opens the correct source file,
  F2 bib entries jump to `.bib` source, F3 merged project outline, F4
  Ctrl/Cmd-click `\input`/`\include`. Shared resolvers in
  `web/src/files/projectPaths.ts` (+ tests). Diagnostics now carry the source
  `file` so log-click jumps to the right file.
- **Typst:** file access with root containment (`src/typst_world.rs`).
- **Autosave + session restore:** `web/src/files/session.ts`, `src/settings.rs`
  session commands.
- **Recent folders/projects**, removed the old 3 sample tabs (now one blank
  `Untitled.md`).
- **GUI + apple-design pass:** motion tokens (`--ease`/`--dur`), tinted log rows,
  draggable console height (vertical `Splitter`), reduced-motion /
  reduced-transparency / contrast media queries, focus-visible rings,
  material edge on toolbar. In `web/src/styles/` + component CSS modules.
- **Auto-update (Tauri updater):** see §4 — **needs manual finish**.
- **Tabbed Settings dialog:** `SettingsDialog.tsx` now left-nav categories
  (Appearance / Editor / LaTeX & PDF / Preview / **Updates**). The Updates tab
  holds the visible "Check for Updates" button (also in command palette).

### Adversarial review paid off
Two workflow review passes found **14 real bugs** despite all static checks
being green — notably F1 was completely non-functional (`file` vs `inputFile`
IPC field mismatch) and a Windows `\\?\` canonical-path mismatch opened
duplicate tabs. All fixed. Lesson: **compiler + unit tests don't catch
cross-IPC-boundary field names, React effect timing, or platform path quirks —
run an adversarial review over the diff before trusting a big change.**

---

## 4. Auto-update — IN PROGRESS (setup done; first release building)

Code/config in place: `tauri.conf.json` updater block, `Cargo.toml` `updater`
+ `process-relaunch` features, `web/src/update/updater.ts`,
`.github/workflows/release.yml`, `RELEASING.md`.

**Progress (as of 2026-07-10):**
1. ✅ Signing keypair generated → `%USERPROFILE%\.tauri\clavis.key` (+ `.pub`).
   **Private key + its password live only on the user's machine — keep safe;
   losing either breaks future update signing.**
2. ✅ Public key pasted into `tauri.conf.json → tauri.updater.pubkey`
   (committed as "Set updater public key"). `cargo check` passes.
3. ✅ GitHub secrets `TAURI_PRIVATE_KEY` + `TAURI_KEY_PASSWORD` set.
4. ✅ Tagged `v1.0.0` → Release workflow **built all 3 platforms green**
   (Windows/macOS/Linux). One gotcha hit + fixed: the workflow needed
   `permissions: contents: write` (default `GITHUB_TOKEN` is read-only →
   "Resource not accessible by integration"); also set repo Settings → Actions →
   Workflow permissions to "Read and write". Both done; committed as
   "CI: grant release workflow contents:write for GitHub Release".

**The CI release pipeline is proven working.** Remaining is manual, deferred by
the user:
- The v1.0.0 Release is still a **draft** — **Publish it** on
  `github.com/ziwangprincex/Clavis/releases` so the `/releases/latest/` endpoint
  (which the app polls) can see it + its `latest.json`. Confirm assets include
  `latest.json` + per-platform installers before publishing.
- **End-to-end auto-update NOT yet tested.** To verify: install v1.0.0, bump
  `tauri.conf.json` version → `1.0.1`, commit, `git tag v1.0.1 && git push
  origin v1.0.1`, publish that release, then in the v1.0.0 app use Settings →
  Updates → "Check for Updates" and confirm it detects + installs 1.0.1.

Explicitly **out of scope** (agreed): OS-level code signing (Apple notarization /
Windows Authenticode) — first-install OS warnings remain, auto-update still works.

---

## 5. Known follow-ups / not done

- **Not verified on real hardware.** Everything is static/unit-verified. GUI feel,
  drag interactions, SyncTeX jumps, the updater end-to-end, reduced-motion — all
  need a human at `tauri dev`. The sandbox is headless.
- **`.gitattributes` for CRLF** not added (see §2).
- **Session restore has no validation** — earlier a stale `session.json`
  accumulated 32 mismatched tabs (title/lang/content desynced), which made a
  `.md` tab compile as Typst and throw `expected expression`. Cleared manually
  (`%APPDATA%\clavis\session.json`). Considered adding dedup + a tab cap +
  title/lang-consistency check on restore — **not done**, worth doing.
- **Forward SyncTeX from a subfile** deliberately deferred (needs decoupling the
  compile-root from the active tab — larger change).
- **PDF large-doc perf** deferred (premature until a real slowdown is observed).
- **npm audit high** (esbuild/vite dev-server only) intentionally not fixed —
  doesn't affect the shipped desktop binary.

---

## 6. Gotchas the next session should not relearn

- **Tauri v1 needs `webkit2gtk-4.0`** → CI/release pin `ubuntu-22.04` (24.04
  removed it). Already handled in both workflows.
- **`cargo check` needs `web/dist` to exist** (`generate_context!`). Build the
  frontend first. CI encodes this ordering.
- **`#[tauri::command]` + module split:** commands are registered in `main.rs`
  by canonical path (`latex::compile::compile_latex`), because `pub use`
  re-export drops the sibling `__cmd__*` macro the handler needs.
- **Frontend uses `window.__TAURI__` directly** (`withGlobalTauri: true`), not
  `@tauri-apps/api` (which is intentionally not installed — `tauri info` warns,
  it's fine). New IPC wrappers go in `web/src/api/tauri.ts`.
- **Rust `Settings` has `#[serde(flatten)] extra`** — frontend-only settings
  round-trip without touching the Rust struct.
- **Path comparisons must use `pathsEqual`/`normalizePath`**
  (`web/src/files/projectPaths.ts`), never raw `===`: Windows canonical paths
  are `\\?\C:\…` while dialog paths are plain `C:\…`. Raw compare = duplicate
  tabs. This bit us twice.
- **Typst syntax ≠ Markdown:** headings are `=`/`==`, not `#`. `#` in Typst is
  code mode. A Markdown doc in a Typst-lang tab throws `expected expression`.
- **Multi-platform `tauri-action` races on release creation.** Create the release
  ONCE (a `create-release` job) and have the matrix upload via `releaseId`; letting
  each job create its own yields duplicate drafts + a split `latest.json`. Fixed in
  `release.yml` — don't undo it.
- **GitHub Secrets vs Variables.** `${{ secrets.X }}` reads only the **Secrets** tab.
  If a value is visible in the UI it's a **Variable** and `secrets.X` is empty
  (checkout fails "Input required and not supplied: token"). Separately, a
  fine-grained PAT that only *reads* fails to push with **403** — it needs
  **Contents: Read and write**.
- **`tauri()` calls throw synchronously outside the app shell** (browser
  `npm run dev`, no `window.__TAURI__`). Guard UI calls with `hasTauri()`; an
  unguarded throw inside a React effect black-screens the whole app (bit us in
  `SettingsDialog`'s `getAppVersion()`).
- **One theme system now.** Chrome color derives from `editor_theme` via
  `web/src/theme/appTheme.ts`; don't reintroduce a separate `ui_theme` path.
