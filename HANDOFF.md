# Clavis - Handoff (updated 2026-08-05)

A working-state handoff so the next session (or a future you) can pick up cold.
**Current state is in §0 below — it supersedes the now-historical §2 (git) and
§4 (auto-update) notes, which are kept only as a record of how we got here.**

---

## 0. Update - 2026-08-06 (Typst static source-file navigation)

Ctrl/Cmd-click navigation now covers static local Typst source references in
addition to LaTeX includes. It marks quoted `.typ` paths in `#include("...")`
and `#import "..."` and resolves only a project-snapshot file relative to the
current Typst document.

- `resolveTypstTarget` requires `.typ`, rejects package (`@...`), absolute,
  URL-like, current-directory/traversal, and non-static forms, then matches only
  a known workspace ProjectFile.
- Link marking is active only for LaTeX/Typst; Markdown gets no source-link
  behavior. The same Ctrl/Cmd modifier preserves ordinary cursor clicks.
- Dynamic imports and all package imports remain intentionally non-navigable;
  no filesystem scan, Typst evaluation, or import execution was added.

### Review findings fixed

1. An initial target test referenced a source file absent from its project
   fixture; adding the exact `chapters/main.typ` fixture ensured the resolver
   proves actual relative behavior rather than a false positive.
2. Tests cover `.typ` resolution plus traversal/package/absolute rejection and
   instantiate the Typst link extension without enabling dynamic behavior.

**Verified:** 101 Rust + 413 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Windows Cargo
may emit a non-fatal incremental-cache access-denied warning after passing
checks; Vite retains its existing `tauri.ts` dynamic/static chunking warning.

---

## 0. Update - 2026-08-06 (isolated submission build verification)

Submission Check now has **Verify build...** after a ready LaTeX bundle
manifest. With an explicit confirmation, Clavis materializes the collector
manifest into a fresh temporary directory and invokes a narrowly allowlisted
LaTeX engine there. It never runs in the source workspace, modifies a source
snapshot/ZIP, retains the generated PDF, or enables shell escape.

- Only `pdflatex`, `xelatex`, and `lualatex` are accepted from `[latex].engine`;
  missing engine configuration defaults to `pdflatex`. Arbitrary executable
  paths and wrappers such as `latexmk` are refused.
- Invocation uses fixed direct argv: `-interaction=nonstopmode`,
  `-halt-on-error`, `-no-shell-escape`, and `-file-line-error`, followed only by
the collector-derived main basename. Standard input is null and PATH uses the
existing bounded engine helper.
- Build runs in a `tempdir`, has a 60-second timeout, a 64 MiB snapshot cap,
  and captures stdout/stderr into temp files rather than pipes, avoiding a
  verbose engine deadlock. Returned log output is capped to 256 KiB / a 12 KiB
tail. Temp source, logs, auxiliary files, and PDF disappear on return.
- UI requires native confirmation, shows success/failure and engine, and offers
  a collapsed log tail. It makes no claim that a successful one-pass build
  verifies bibliography reruns, all publication requirements, or anonymity.

### Review findings fixed

1. The first process design piped output while polling `try_wait`, which could
   deadlock if TeX filled its pipe. Verification now writes bounded-review logs
   inside the temporary snapshot.
2. Engine input is allowlisted rather than accepting generic config text or a
   custom executable path.
3. Tests prove the fixed argument vector includes `-no-shell-escape` and reject
   `latexmk`; verification also refuses unresolved collector manifests before
   spawning anything.
4. Build verification remains separate from source snapshot and ZIP creation,
   so an engine failure cannot leave or mutate an export artifact.

**Verified:** 101 Rust + 409 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Windows Cargo
may emit a non-fatal incremental-cache access-denied warning after passing
checks; Vite retains its existing `tauri.ts` dynamic/static chunking warning.

---

## 0. Update - 2026-08-06 (manifest-confined submission ZIP export)

Submission Check now has **Create ZIP...** after a ready LaTeX bundle manifest.
It writes a source-only archive outside the workspace, using exactly the same
confined collector manifest as the source snapshot. It does not build,
anonymize, execute a process, alter source files, overwrite an existing archive,
or access a remote.

- Archive creation revalidates the workspace, manifest readiness, relative
  collector paths, destination containment, and the existing 64 MiB aggregate
  source limit.
- A UUID-named `.zip.tmp` is built beside the destination and renamed only after
  `ZipWriter::finish` succeeds. Any error removes that temporary archive
  best-effort. The final random archive name cannot overwrite a prior export.
- Zip entries preserve only safe project-relative paths and bytes returned by
the collector; binary base64 is decoded locally. No uncollected workspace file
or config metadata is silently swept in.
- UI describes both source snapshots and ZIP exports as ready-manifest copies
outside the workspace. It reports final archive path, file count, and byte
count. Snapshot build verification remains deliberately separate because it
introduces an external process boundary.

### Review findings fixed

1. ZIP export is not implemented as ?zip the selected folder?; it reuses the
   collector manifest, so ignored/editor/build debris cannot leak into a
   submission archive.
2. Tests open the resulting ZIP and verify both the LaTeX source and binary
   resource entries, while proving the original workspace source remains intact.
3. Archive creation shares the same unresolved-dependency and destination-inside-
   workspace rejection behavior as source snapshot creation.
4. The UI only enables ZIP after a fresh ready manifest, preventing a stale or
   incomplete collector result from becoming an archive.

**Verified:** 99 Rust + 409 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Windows Cargo
may emit a non-fatal incremental-cache access-denied warning after passing
checks; Vite retains its existing `tauri.ts` dynamic/static chunking warning.

---

## 0. Update - 2026-08-06 (bounded local Git stage and commit)

The Git sidebar now supports a deliberately narrow local write workflow:
**Stage** / **Unstage** an already-listed changed file, then create a confirmed
local commit. It remains impossible in Clavis to push, fetch, pull, checkout,
reset, restore the worktree, rebase, merge, change branches, or contact a
remote.

- Backend accepts only a canonical directory and a freshly revalidated changed
relative path. Absolute, empty, `.` / `..`, prefix, and stale paths are refused.
Stage executes fixed `git add -- path`; unstage executes only `git restore
--staged -- path`, which changes the index but not the worktree.
- To prevent staging from becoming a repository-controlled process-execution
surface, Clavis queries the file's `filter` attribute and refuses any configured
Git clean filter. Every Git invocation is direct argv, 5-second bounded, and
has null stdin.
- Local commit accepts a non-empty single-line message of at most 200
characters, needs at least one tracked staged change, uses `--no-gpg-sign`, and
sets `core.hooksPath` to a fresh empty temporary directory. `--no-verify` alone
is not treated as sufficient: post-commit hooks are disabled too.
- UI requires an explicit native confirmation showing the exact commit message
and says plainly that it does not push or contact remotes. The commit widget is
labelled ?Local only - no push - hooks skipped.?

### Review findings fixed

1. Initial staging would have allowed a repository-defined clean filter such as
   Git LFS; those files are now rejected before `git add`.
2. Initial commit safety relied on `--no-verify`, which does not suppress every
   hook type. A fresh empty `core.hooksPath` now prevents repository hooks from
   running; the integration test installs a post-commit hook and proves it does
   not fire.
3. Path validation was tightened to reject current-directory segments as well as
   absolute/traversal paths.
4. The only Git write argv forms are `add`, `restore --staged`, and `commit`;
   tests exercise local stage/unstage/commit behavior, message validation,
   filter detection, and hook suppression. No remote argv is accepted anywhere.

**Verified:** 98 Rust + 409 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Windows Cargo
may emit a non-fatal incremental-cache access-denied warning after passing
checks; Vite retains its existing `tauri.ts` dynamic/static chunking warning.

---

## 0. Update - 2026-08-06 (fine-grained research prose estimates)

The status bar now extends the existing document and Abstract prose estimates
with local research-writing views: **Selection**, **Section**, **Caps**, and
**Notes**. All display `?` explicitly because these are textual estimates, not
publisher or compiler word counts.

- The editor now publishes current selection offsets along with line/column.
  A non-empty selection gets a language-aware estimated prose count.
- Current Section is inferred from the closest preceding Markdown/Quarto
  heading, Typst heading, or LaTeX section/subsection/subsubsection, stopping
  at the next same recognized heading. Heading text itself is excluded.
- Caption estimates recognize Markdown image alt text, common LaTeX
  `\caption{...}`, and Typst `#figure(..., caption: [...])`; note estimates
  recognize Markdown numeric footnote definitions, LaTeX `\footnote{...}`, and
  Typst `#footnote[...]`.
- Each region is passed through the same local markup/code/math-stripping model
  already used for Main and Abstract. No file I/O, compilation, AST evaluation,
  citation lookup, or external service is added.

### Review findings fixed

1. The first Typst figure matcher stopped at `image("...")`'s inner close
   paren before reaching `caption:`. It now conservatively scans to the figure
   call's later close and has a regression test.
2. Selection offsets can outlive the debounced document snapshot briefly; all
   slices are clamped to the current debounced text, preventing invalid ranges.
3. The UI avoids presenting zero-valued caption/note cells unless at least one
   recognized region exists, while selection/section retain distinct `null`
   semantics when unavailable.
4. Tests cover Markdown selection/section/caption/footnote estimates plus
   LaTeX and Typst caption/note forms; results remain estimates rather than
   claims of full macro-aware counting.

**Verified:** 94 Rust + 409 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Windows Cargo
may emit a non-fatal incremental-cache access-denied warning after passing
checks; Vite retains its pre-existing `tauri.ts` dynamic/static chunking
warning. Future work is now primarily optional polish / separately-reviewed
Git write workflows rather than a known blocker in the core research workbench.

---

## 0. Update - 2026-08-06 (asset previews and language-aware insertion)

The Asset sidebar now supports an on-demand **Preview** and **Insert** action
for each indexed workspace asset. Preview is an optional visual aid; insertion
adds only an appropriate reference at the current editor cursor.

- New `asset_preview` IPC canonicalizes both root and asset, requires the asset
to stay inside the workspace, accepts only indexed image extensions, and reads
at most 2 MiB. It returns a local data URL only for PNG/JPEG/GIF/WebP/SVG;
PDF/EPS/TIFF remain honestly unsupported rather than attempting an unsafe or
heavy conversion.
- No preview is read until the user requests it; it opens no external program,
writes nothing, creates no cache, and does not copy/move assets.
- Insert text is language-aware: LaTeX `\includegraphics{...}`, Typst
`#image("...")`, Markdown/Quarto `![](...)`. Escaping is narrowly tailored to
each syntax, and all insertion is through the existing editor text operation.
- The panel continues to open an asset through the existing explicit Open action
and retains usage diagnostics / jump-to-use behavior.

### Review findings fixed

1. The first UI treated every null preview as perpetually loading. It now tracks
   request completion and reports that the format or file size is unsupported.
2. Preview reads are root-confined and size-limited independently of the asset
   index. Tests cover valid PNG data URLs, unsupported PDF, and outside-root
   rejection.
3. Insert tests cover all three languages plus syntax-significant characters;
   the implementation does not use a generic escaping routine that would make
   any language's output misleading.
4. The browser receives a data URL only after a backend-validated local read;
   it is not given arbitrary filesystem/image URL access.

**Verified:** 94 Rust + 407 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. The recurring
Windows Cargo incremental-cache access-denied warning may appear after passing
tests; the test run succeeds. Vite retains its pre-existing `tauri.ts`
dynamic/static chunking warning. Finer-grained research word statistics remain
a recommended next slice.

---

## 0. Update - 2026-08-06 (bounded LaTeX custom macro intelligence)

LaTeX completion and signature help now recognize common user command
declarations from the active document and in-workspace LaTeX snapshot:
`\newcommand`, `\renewcommand`, `\providecommand`, and xparse-style
`\NewDocumentCommand` / `\RenewDocumentCommand` /
`\ProvideDocumentCommand`.

- New frontend-only `latexMacroScan` strips comments and common verbatim-like
environments, caps declarations at 500 and xparse specs at 600 characters, and
recovers only the declaration shape: ordered required/optional argument slots.
It never expands TeX, evaluates definitions, runs a compiler, or chases inputs.
- Custom commands appear above the generic CWL corpus in completion. Required
arguments get named placeholders (`arg1`, `arg2`); workspace declarations rank
below declarations in the active file, whose current text always wins.
- Signature help displays declaration-order slots, including classic optional
arguments and a bounded subset of xparse spec letters. It deliberately labels
only `optional` and `argN`, rather than pretending TeX macro bodies supply type
or semantic information.
- Existing project-defined environments were already supplied by the LaTeX
semantic provider; this slice preserves that behavior and concentrates on
command declarations.

### Review findings fixed

1. The first classic parser misclassified its optional default bracket; it now
   records an ordered slot list and subtracts it from the mandatory count.
2. A first regex-only xparse matcher failed on common nested defaults such as
   `O{wide}`. It now uses a bounded brace scan after detecting the declaration
   command.
3. Active-document precedence initially lost to later workspace files. The
   workspace scanner now processes the active document last so unsaved edits
   shadow project snapshots.
4. Tests explicitly exclude commented/verbatim declarations and out-of-root
   workspace files; they also cover classic/xparse signature ordering and the
   existing CWL fallback boundary.

**Verified:** 93 Rust + 405 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. The Vite build
retains its pre-existing dynamic/static `tauri.ts` chunking warning. Asset
thumbnails/drag insertion and finer-grained research word statistics remain
future slices.

---

## 0. Update - 2026-08-06 (bounded Typst workspace import intelligence)

Typst completion now understands a deliberately limited static workspace scope.
For a saved workspace file, Clavis follows quoted relative `.typ` imports already
present in the editor/project snapshot and offers imported `#let` functions,
values, selected aliases, and module aliases. Imported functions keep their
actual required parameter names in the insertion snippet.

- New frontend-only `typstWorkspaceScan` never reads the filesystem, evaluates
  Typst, launches a language server, or executes imports. It follows at most 12
  levels / 80 files, detects cycles, and accepts only quoted relative `.typ`
  imports confined beneath the workspace root.
- Supported static forms include `#import "lib.typ": *`, selected imports with
  `as` aliases, and `#import "lib.typ" as module`. Local definitions shadow
  imports. Dynamic expressions, package imports (`@preview/...`), absolute and
  traversal paths, comments, and malformed selector fragments are ignored.
- In `#set name` completion, only standard-library functions with settable
  parameters appear; accepting one inserts just the selector, not a duplicate
  hash/call. `#show name` similarly offers selector names only. This is syntax
  assistance, **not** a claim that Clavis evaluates #set/#show transformations.
- Existing Typst builtin and document-local completion behavior is preserved;
  imported symbols rank below local ones but above the broad standard library.

### Review findings fixed

1. The initial static import matcher would treat any selector containing `*` as
   a star import; it now recognizes only a standalone comma-delimited `*`.
2. Leading `./` static paths are normalized and allowed; `.` / `..` path
   segments after normalization remain rejected.
3. Direct provider tests prove imported function parameter insertion and reject
   dynamic imports; scanner tests cover aliases, nested imports, local shadowing,
   comments, traversal/package exclusion, and cycles.
4. `#set` / `#show` support is intentionally completion-only. No style-result,
   selector resolution, or cross-file semantic inference is exposed as fact.

**Verified:** 93 Rust + 400 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. The Vite build
retains its pre-existing dynamic/static `tauri.ts` chunking warning. LaTeX macro
analysis, asset thumbnails/drag insertion, and finer-grained research word
statistics remain future slices.

---

## 0. Update - 2026-08-06 (explicit local Zotero SQLite search)

Bibliography now has **Search local Zotero...**. It asks the user to select a
specific `zotero.sqlite` file with the native picker, then offers bounded local
search and citation-key insertion alongside the existing `.bib` / Better
BibTeX workflow. It does not auto-discover profiles, launch Zotero, access the
network, write the database, or turn Zotero into a project dependency.

- New `src/zotero.rs` canonicalizes the selected path, accepts only a regular
  file literally named `zotero.sqlite` (up to 2 GiB), opens it with SQLite
  read-only flags, sets `query_only`, uses a one-second busy timeout, and runs
  fixed SQL only. No user query is interpolated into SQL.
- Search is capped at 160 characters, fetches at most 1,500 recent live items,
  filters locally, and returns at most 200 results. It reads key, type, title,
  creator names, date, venue, DOI, URL, tags, and a Better BibTeX-style
  `Citation Key:` / `Citekey:` line from Zotero's Extra field.
- Deleted items are excluded. Rows without a citation key remain visible but
  cannot be inserted; this is honest about Zotero data rather than inventing a
  citekey. Insertion continues to use Clavis's language-aware existing cite
  insertion and recent-citation history.
- Better BibTeX export polling remains the project-configured, reproducible
  source used by reference diagnostics. Direct Zotero search is deliberately
  explicit, session-only, and separate.

### Review findings fixed

1. The initial implementation used the SQLite no-mutex flag unnecessarily;
   removed it so each worker keeps SQLite's normal connection mutex behavior.
2. Fixture tests now compare database bytes before/after search and prove no
   `-wal` or `-shm` files are created.
3. The frontend first hid Zotero when no workspace `.bib` existed. It now keeps
   local Zotero search available while clearly preserving the normal empty Bib
   state below it.
4. The SQL is fixed and bounded; query terms are post-filtered rather than
   becoming dynamic SQL or FTS syntax.

**Verified:** 93 Rust + 392 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Cargo may emit
an intermittent Windows incremental-cache access-denied warning after tests;
the test command still succeeds. The Vite build retains its pre-existing
`tauri.ts` dynamic/static chunking warning. Typst import/set/show intelligence,
LaTeX macro analysis, asset thumbnails/drag insertion, and finer-grained word
statistics remain future slices.

---

## 0. Update - 2026-08-06 (confined LaTeX submission source snapshot)

The former read-only Bundle manifest now has a deliberately narrow **Create
bundle...** follow-up. After inspecting a ready manifest, the user chooses an
existing destination folder with the native directory picker; Clavis copies the
collected LaTeX source snapshot into a newly generated child directory there.
It does **not** build, run an external command, anonymize, zip, overwrite an
existing directory, or alter the source workspace.

- Creation re-reads/canonicalizes source and destination immediately before
  copying. The destination must be an existing directory outside the source
  workspace.
- Only files returned by the confined LaTeX collector are written. Every
  collected relative path is re-validated, text and binary representations are
  mutually exclusive, binary base64 is decoded locally, and the aggregate
  snapshot has a 64 MiB cap.
- Files first go to a UUID-named sibling staging directory; a successful rename
  publishes the complete snapshot atomically. Failed copies remove that staging
  directory best-effort.
- Standard TeX-distribution `\documentclass`/`\usepackage` dependencies no
  longer make a source snapshot unready: they are not portable project files.
  Missing in-workspace source/includes/bibliographies still block creation.
- Submission Check explains the exact scope and reports the created path, file
  count, and byte total. The button remains disabled until a fresh ready
  manifest exists.

### Review findings fixed

1. The initial collector treated installed `article`/`amsmath` as unresolved
   project files, making ordinary papers impossible to snapshot. It now ignores
   unresolved class/package references while preserving warnings for source and
   bibliography dependencies.
2. The first snapshot test bypassed the public creation path. It now exercises
   `create_bundle_sync` directly, including final-directory generation.
3. Failure testing originally only tested the low-level writer. It now injects
   an invalid collector path into the full staged creation path and proves the
   output folder is empty afterward.
4. A selected destination inside the source workspace is rejected, preventing
   generated output from being swept into future manifests. A successful bundle
   has a random new name and cannot overwrite a prior snapshot.

**Verified:** 90 Rust + 392 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. The Vite build
retains its pre-existing dynamic/static `tauri.ts` chunking warning. Archive
creation, compilation-from-snapshot, anonymous variants, direct Zotero
read-only search, Typst import/set/show intelligence, and LaTeX macro analysis
remain future slices.

---

## 0. Update - 2026-08-05 (project writing preferences)

`clavis.toml` can now carry a bounded local Writing policy:

```toml
[writing]
spelling = "us" # us | uk | mixed
ignored_acronyms = ["GDP", "IV"]
terms = ["difference-in-differences", "heteroskedasticity"]
```

- Configuration validation accepts only `us`, `uk`, or `mixed`; limits each
  list to 500 items; requires ignored acronyms to be 2?12 uppercase
  alphanumeric characters; and rejects blank, multiline, or overlong terms.
- Writing checks now receive the project policy. A US/UK choice flags the
  opposite spelling even when its counterpart is absent; `mixed` suppresses
  spelling-variant diagnostics. Configured ignored acronyms suppress only the
  matching first-use reminder.
- The Writing sidebar states the active policy and counts. Saved project terms
  are explicitly descriptive vocabulary for future spelling adapters; they do
  not pretend to alter today?s local rules.
- Frontend IPC has the camelCase writing contract (`ignoredAcronyms`) while TOML
  keeps the ergonomic `ignored_acronyms` form.

### Review findings fixed

1. The first implementation only warned about a configured US/UK form when
   both variants appeared. It now enforces the selected convention directly.
2. The Rust frontend serializer needed `camelCase` on `WritingSection`; an
   `ignored_acronyms` alias preserves TOML compatibility.
3. Tests originally checked only a mixed sentence. They now cover one-sided US
   and UK enforcement, `mixed` suppression, analyzer/store option propagation,
   config deserialization, and invalid configuration.
4. `terms` intentionally remains inert. It is surfaced with an explicit UI
   explanation rather than implying unavailable spellchecking behavior.

**Verified:** 85 Rust + 392 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. The Vite build
retains its pre-existing dynamic/static `tauri.ts` chunking warning. Next
planned high-risk slice is manifest-confined clean rebuild / bundle writing;
Zotero local read-only search remains separate from Better BibTeX.

---

## 0. Update - 2026-08-05 (LaTeX submission bundle manifest dry run)

The first bundle-related slice is intentionally **read-only**. Submission Check
now has a Bundle manifest button that reports what Clavis would include for a
configured LaTeX `project.main`: source, bibliography, styles/classes and binary
resources, with collector warnings. It does not copy, build, zip, anonymize or
modify anything.

- New `src/submission_bundle.rs` reuses the existing confined LaTeX project
  collector rather than implementing another dependency traversal. It requires a
  valid `clavis.toml` and in-root LaTeX `project.main`.
- Manifest records relative path, bundle kind and estimated bytes. Existing
  collector bounds/path warnings determine readiness.
- UI nests manifest output in Submission Check, including source file list and
  warnings.

### Review findings fixed

1. The first raw-string path regex in Submission Check did not compile.
2. Submission modules initially passed zero tests until registered in `main.rs`;
   real registration was required before treating green tests as evidence.
3. Bundle write/exec audit showed only test-fixture `std::fs::write`; production
   manifest code has no copy/rename/remove/Command/spawn path.

**Verified:** 82 Rust + 388 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Clean rebuild,
anonymous variants and zip creation remain a separate high-risk write slice.

---

## 0. Update - 2026-08-05 (read-only Submission Check preflight)

A bounded, read-only submission preflight is complete. Command palette:
**Run Submission Check**. It reports visible static issues and jumps to source;
it does not build, anonymize, alter files, create a zip, or push anything.

- New `src/submission_check.rs` scans Workspace source Documents with open-
  Document overrides, bounded at 10,000 nodes / 2 MiB per source file and no
  symlink traversal.
- Rules: TODO/FIXME/XXX, obvious local absolute Windows/Unix paths, LaTeX author
  / thanks / affiliation metadata, Markdown author front matter, Typst document
  author metadata, and LaTeX `\write18` shell-escape markers.
- Submission Check dialog distinguishes warning/info, reports scanned/truncated
  state, and jumps to path/line. Non-fatal author metadata is intentionally info
  rather than pretending every project needs an anonymous manuscript.

### Review findings fixed

1. Initial raw-string absolute-path regex terminated at a quote/apostrophe
   boundary and did not compile.
2. First test run was zero tests because the new module had not been registered
   in `main.rs`; registration exposed the real tests.
3. Frontend Submission API types/wrapper were missing after an interrupted write,
   so the dialog was correctly blocked by typecheck until the IPC contract landed.
4. Open-document override language was initially ignored; it now overrides disk
   language consistently with other workspace index modules.
5. A new `main.rs` module line carried CRLF trailing whitespace; fixed before
   full validation.

**Verified:** 80 Rust + 388 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Reference/asset
missing diagnostics, clean rebuild, anonymous variants and source bundle creation
remain separate future cuts.

---

## 0. Update - 2026-08-05 (read-only Git status, history, and prose diff)

A deliberately read-only Git slice is complete. The Git sidebar shows branch,
ahead/behind, changed/untracked files, recent commits, raw `HEAD` file diff and
a word-level prose overlay. No stage, commit, checkout, reset, restore or push
capability was added.

- New `src/git_inspect.rs` runs only `git status --porcelain=v1 --branch`,
  `git log`, and `git diff HEAD` with fixed argv, Workspace cwd, relative-path
  confinement, 5-second timeout, 1 MiB diff cap, null stdin and no shell.
- Non-repository folders are a normal empty state; history is not requested
  after status reports `isRepository: false`.
- Pure frontend `proseDiff` performs bounded word-level LCS (700-token cap) and
  falls back to line-level insert/delete for large files. LaTeX normalization
  removes comments, whitespace and common cosmetic emphasis commands first.
- Git panel refreshes on Workspace open or explicit command; selecting a changed
  file shows raw diff plus prose insert/delete overlay and five recent commits.

### Review findings fixed

1. IPC parameter `root` shadowed the backend root helper and prevented compile.
2. Initial file diff only showed unstaged changes; it now compares `HEAD`,
   covering staged plus unstaged changes.
3. Non-repository directories initially caused `Promise.all` history failure even
   after status had a graceful fallback.
4. Word-diff algorithm gets a hard token cap with a test proving line-level
   fallback, avoiding quadratic behavior on long papers.

**Verified:** 78 Rust + 388 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Git write
operations remain intentionally out of scope for a future separately-reviewed
cut.

---

## 0. Update - 2026-08-05 (local academic writing consistency checks)

A bounded, local-only writing-quality slice is complete. The new Writing sidebar
checks **open** Markdown/Quarto, LaTeX and Typst Documents after a 700 ms debounce
and caps output at 500 diagnostics.

- Explainable rules: `50 %` spacing, `p value`, p-comparison consistency hints,
  Figure/Fig. and Table/Tab. mixing, selected US/UK spelling-pair mixing, and
  first-use acronym reminders. Diagnostics jump to source line.
- Language-aware masking ignores LaTeX comments/verbatim/lstlisting/minted, Typst
  comments/raw, and Markdown fenced/inline code. It is intentionally not a
  grammar, spelling, or style-guide replacement; no external service or text
  leaves the machine.
- Acronym detection now respects reading order: a later `(GDP)` definition cannot
  excuse an earlier `GDP` use; definitions before use are accepted. A small built-
  in technical acronym ignore set avoids obvious noise.

### Review findings fixed

1. Initial acronym definition collection scanned globally, allowing later
   definitions to suppress earlier-use diagnostics.
2. A Python patch inserted control characters for `\b` and a malformed regex,
   so Vite could not transform the module; the rules module was rewritten with
   literal-safe source text.
3. The first default ignore set included GDP, which invalidated the first-use
   regression test; GDP is now checked like other research abbreviations.

**Verified:** 76 Rust + 383 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Project
dictionaries, external Harper/Vale/LanguageTool adapters, section/selection
counts and journal-specific style packs are separate future slices.

---

## 0. Update - 2026-08-05 (cross-language research word estimates and limits)

The status bar now reports estimated **Main** and **Abstract** prose words for
Markdown/Quarto, LaTeX and Typst, plus optional limit warnings configured in
Settings ? Editor. This is explicitly a submission helper estimate, not a
publisher/offical word-count claim.

- New pure `computeResearchStats` strips language-specific markup/code/math:
  Markdown front matter/fenced+inline code/link URLs/math; LaTeX comments,
  math/verbatim/listing/bibliography environments, common citation/reference
  commands; Typst comments/raw/math and common inline code calls.
- Abstract extraction supports Markdown heading, LaTeX abstract environment, and
  Typst `= Abstract`, continuing across paragraphs until the next section/EOF.
  Main estimate excludes the Abstract itself.
- Settings persist optional `writing_main_word_limit` and
  `writing_abstract_word_limit` (0 disables each). Status cells show `?` and
  warn only when estimated prose exceeds a configured limit.

### Review findings fixed

1. Initial stats implementation used Rust/PCRE inline regex flags and `\z`;
   JavaScript/Vite rejected the module before any test ran.
2. Main prose initially included Abstract despite its name; strict tests now
   assert exclusion.
3. A multi-paragraph Abstract regression test was initially written as an
   invalid multiline single-quoted JS string; converted to template literals.
4. Abstract lookahead was corrected to stop only at the next heading or real EOF,
   not each line end under multiline mode.

**Verified:** 76 Rust + 378 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Selection and
section-level counts, caption/footnote policies, and journal-specific counting
rules remain future slices.

---

## 0. Update - 2026-08-05 (cross-language asset references and diagnostics)

A bounded asset-relationship slice is complete. The new Assets sidebar indexes
local image/PDF-like assets and their explicit usages across LaTeX, Typst, and
Markdown/Quarto.

- New `src/assets.rs`: scans local PNG/JPEG/SVG/PDF/EPS/GIF/WebP/TIFF assets and
  source Documents with bounded 10,000-node / 2 MiB source-file limits, no
  symlink following, and Workspace canonical containment.
- Usage recognition: LaTeX `\includegraphics` (including extensionless paths),
  Typst static `#image("...")`, and Markdown/Quarto `![...](...)`. Remote/data
  URLs and dynamic/escaped Typst paths are intentionally not guessed.
- Diagnostics: missing asset usage (error) and unused local asset (warning).
  Missing/unused conclusions are not overclaimed when scan truncates.
- Code examples are excluded: LaTeX comments/verbatim/lstlisting/minted and
  Markdown inline/fenced code do not create fake missing assets.
- Assets panel can refresh, open a local asset with the OS handler, or jump from
  a usage/diagnostic back to its source.

### Review findings fixed

1. First `cargo test assets` passed zero tests because the module had not been
   registered; registration exposed fixture and Typst AST argument-shape bugs.
2. Test overrides must reference real Workspace paths; the index intentionally
   does not index ghost/scratch paths as saved Workspace Documents.
3. Typst `#image` has direct `Str` argument nodes in 0.11, unlike wrapped forms
   seen elsewhere; both safe forms are handled.
4. Markdown masking was constructed but accidentally unused; code-block false
   positives caught it.

**Verified:** 76 Rust + 374 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. This slice does
not include thumbnails, drag/drop copy, OCR, generated-image provenance, or
automatic path rewriting; those remain separate follow-ups.

---

## 0. Update - 2026-08-05 (CSV/TSV to Markdown, LaTeX booktabs, and Typst table)

A small, self-contained table-conversion slice is complete. Command palette:
**Convert CSV / TSV to Table** ? paste data ? choose output ? preview ? insert
into the active Document.

- New pure `tables/delimited.ts`: bounded 1 MiB input / 500 rows / 100 columns,
  quoted CSV cells, TSV auto-detection, CRLF, embedded quoted newlines, ragged
  row padding, and clear unclosed-quote errors.
- Native output: Markdown/Quarto pipe table, LaTeX `booktabs` tabular, or Typst
  `#table` with a `table.header`. Escaping is deliberately rendered per character
  for LaTeX, avoiding the classic bug where replacement order re-escapes the
  newly generated `\textbackslash{}`.
- The dialog has no file IO, no clipboard permission, no data persistence and no
  computation beyond local conversion. It inserts text through the existing
  editor seam.

### Review findings fixed

1. Initial LaTeX escape replacement order could corrupt its own generated escape
   macro; the regression test now includes backslash and braces.
2. Initial preview used `setState` inside `useMemo`; preview is now a pure derived
   `{text,error}` value.
3. Initial CSS used unscoped `header`, `footer`, and `button` selectors that could
   affect unrelated dialogs; selectors are now module-scoped.
4. Typst output intentionally calls `text("...")` for every cell, so numerical
   formatting/alignment is not claimed. Regression-table semantics are deferred.

**Verified:** 72 Rust + 374 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean.

---

## 0. Update - 2026-08-05 (Generated Artifacts foundation)

One bounded research-artifact slice is complete: project configuration can now
declare generated tables, figures and documents, tie them to source files and an
existing Project Task, and surface their freshness in the sidebar.

```toml
[artifacts.baseline_table]
path = "paper/tables/baseline.tex"
kind = "table"
task = "tables"
sources = ["scripts/tables.R", "data/derived/analysis.csv"]
```

- New `ArtifactConfig` validates relative artifact/source paths, source count
  (max 200), and referenced task existence in the existing `clavis.toml` seam.
- New deep backend module `src/artifacts.rs` reports `missing`, `stale`, or
  `ready`: missing artifact; missing source; or any source newer than artifact.
  It uses canonical containment checks, does not follow symlinks, and only opens
  existing files inside the Workspace.
- New Artifacts sidebar panel displays status/reason/sources and can open an
  artifact or invoke its already-declared Task via the existing Task Run seam.
  It refreshes on Workspace open, explicit refresh, and terminal Task state.
- Artifact reads run in `spawn_blocking`; stale async frontend results are
  generation-gated. Ordinary folders with no valid `clavis.toml` do not show a
  misleading artifact error.

### Review findings fixed

1. Initial implementation returned a reference to a temporary source path.
2. A PowerShell heredoc mistake aborted before frontend store files were written;
   the retry was performed with native PowerShell writes and then checked.
3. Adding required `artifacts` to the frontend config type broke existing test
   fixtures; it is optional at the IPC type seam for old configs.
4. Artifact status initially would show config-read errors for any opened folder.
5. `rustfmt`-caused LaTeX module noise remains unstaged; only semantic files are
   included in the eventual commit.

**Verified:** 72 Rust + 369 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Status uses
declared source timestamps only; no glob dependencies, content hashing, CSV
conversion, image thumbnails, or artifact dependency graph were added yet.

---

## 0. Update - 2026-08-05 (Better BibTeX local export freshness and refresh)

A local-only Better BibTeX integration slice is complete. It does **not** read
or write Zotero SQLite, invoke Zotero, open attachments, or use network APIs.

```toml
[bibliography]
provider = "better-bibtex"
files = ["references/library.bib"]
```

- `clavis.toml` validates provider `better-bibtex|local`, up to 50 relative
  in-Workspace `.bib` files.
- New `src/bibliography_export.rs` is a read-only mtime/size status probe for
  declared exports with canonical containment. It does not watch arbitrary
  local paths.
- Bibliography panel polls Better BibTeX exports every five seconds; a changed
  size/mtime triggers local Bib parser refresh and unified reference/citation
  index refresh. Status text identifies the export or a missing declared file.

### Review findings fixed

1. First export module test passed zero tests because `main.rs` registration
   anchor failed; registration was fixed before treating tests as evidence.
2. Interrupted UI patch attempts left backend/IPC complete but BibSection
   unchanged; the component was rewritten as one coherent file instead of
   stacking fragile partial substitutions.
3. Export changes initially refreshed only the bibliography list, leaving
   completion and missing-citation diagnostics stale; App now refreshes the
   unified reference index too.

**Verified:** 84 Rust + 388 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Zotero library
search and attachment opening remain separate later slices.

---

## 0. Update - 2026-08-05 (rich local bibliography search and multi-citation insertion)

A deliberately local-only bibliography slice: no Zotero database access, Better
BibTeX watcher, DOI network lookup, or metadata mutation was added.

### Parser and bounded execution

- `src/bib.rs` was deepened into a degradation-friendly parser for braced and
  parenthesized entries, nested braces, escaped quoted values, bare values, and
  case-insensitive fields. One malformed entry recovers at the next indented
  entry marker instead of consuming the rest of the library.
- Rich metadata: author/editor, year/date, journal/journaltitle, booktitle,
  publisher, normalized DOI, URL, abstract, keywords, volume, issue/number, pages,
  and entry start/end lines. Comment/string/preamble records remain excluded.
- Parsing is off the Tauri runtime via `spawn_blocking`, bounded to 200 files,
  16 MiB per file, and 100,000 entries. Full BibTeX macro concatenation is not
  evaluated; unsupported tails are consumed safely rather than guessed.

### Search and insertion UX

- New pure `bibliography/rank.ts` builds normalized search documents once, then
  applies explainable all-token ranking: exact/prefix citekey, author/year,
  title/venue, DOI/keywords/abstract. Recent keys and project citation count are
  secondary boosts only. Empty search orders recent, project frequency, year, key.
- Search is debounced 120 ms and display remains capped at 200 rows for large
  libraries. Metadata details are expandable; long abstracts scroll within a
  bounded region. Source jump remains available.
- Checkbox multi-selection plus Insert Selected; double-click inserts one entry.
  Recent citation history (50 keys) persists through frontend-owned Settings.
- Native multi-key syntax: `\cite{a, b}`, `@a @b`, or `[@a; @b]` for LaTeX,
  Typst, and Markdown/Quarto. Duplicate requested keys are removed.

### Review findings fixed

1. Parser rewrite tests initially used an invalid double-backslash quote fixture
   and an incorrect end-line expectation; fixtures were corrected rather than
   weakening parser semantics.
2. Unclosed entries could consume a later valid indented entry; line-start
   recovery now treats optional indentation correctly.
3. A `rustfmt` invocation formatted the entire LaTeX module tree; unrelated diffs
   were explicitly restored and are excluded from the commit.
4. Python-generated template strings again dropped a LaTeX backslash; citation
   formatting now uses explicit string concatenation and regression tests.
5. Checkbox labels plus row double-click produced unstable double toggles; the
   selection control and insertion button are separate interactive targets.
6. Re-normalizing every field on every keystroke would jank large libraries;
   normalized entry indexes are memoized and queries debounced.

**Verified:** 69 Rust + 368 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Real-window checks
remain for sidebar density, keyboard selection ergonomics, and a genuinely large
Better BibTeX export. Zotero/Better BibTeX integration is a separate future slice.

---

## 0. Update - 2026-08-05 (Quarto/Pandoc trusted render foundation)

One deliberately bounded slice: saved `.qmd`/`.md` Documents can now render or
export to HTML, PDF, or DOCX through Quarto/Pandoc. No YAML schema, preview
server, notebook kernel, Zotero, or table tooling was mixed into this change.

### Architecture and safety

- New deep backend adapter `src/document_tools.rs` exposes only fixed enum-like
  choices (`quarto|pandoc`, `html|pdf|docx`). The frontend cannot submit an
  executable or argv. Documents are canonicalized and confined to the Workspace.
- The existing Task Run implementation was deepened with an internal
  `start_configured_run` seam; Quarto/Pandoc reuse its streaming output, one-run
  reservation, timeout, process-group cancellation and TaskPanel rather than
  creating a second process system.
- First render explicitly requests Workspace Trust even when `clavis.toml` has no
  task definitions. Backend trust/path/tool validation is repeated at execution.
- Dirty Documents are rejected so external tools cannot silently render stale
  disk content. Tool detection uses the same enriched PATH as Task Run and has a
  three-second timeout.

### Product behavior

- `.qmd` remains the Markdown editor language and Session schema, but the status
  bar labels it Quarto; file dialogs include `.qmd`.
- Command palette entries: Quarto Render HTML/PDF/DOCX and Pandoc Export
  HTML/PDF/DOCX. Successful runs locate the newest matching artifact and open it
  with the OS default application. Nested Pandoc sources write beside themselves.
- Artifact lookup checks common Quarto outputs plus a bounded 10,000-node
  Workspace search for custom output directories; symlinks and dependency/VCS
  trees are skipped. Only Workspace-contained HTML/PDF/DOCX can be opened.
- Project Doctor now reports Quarto/Pandoc path/version, `_quarto.yml` or
  `_quarto.yaml`, and standalone `.qmd` count.

### Review findings fixed

1. Quarto workspaces without configured tasks were `not-required` for trust but
   rendering still executes external code; trust is now requested on first run.
2. Pandoc nested-document output and artifact lookup initially disagreed.
3. A fast process could emit start/output before the start IPC resolved; the Task
   store now accepts the matching early run event, with a regression test.
4. Failed/cancelled renders could leave stale artifact context and later open the
   wrong output.
5. Tool version probing could hang Project Doctor indefinitely.
6. Fixed `_site/_book/docs` assumptions missed custom Quarto output directories.

**Verified:** 69 Rust + 364 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Real-window checks
remain for native Trust, cancellation of an actual Quarto child tree, and OS
opening of HTML/PDF/DOCX. Artifacts currently open externally; an embedded HTML
preview server or routing PDFs into Clavis' viewer is a separate future slice.

---

## 0. Update - 2026-08-05 (cross-language reference index, diagnostics, navigation, and safe rename)

A unified reference layer now treats **LaTeX and Typst as equal first-class
languages**, with deliberately smaller Pandoc/Quarto Markdown coverage.

### Index and diagnostics

- New deep Rust module `src/references.rs` indexes Workspace disk files with
  open-Document overrides, bounded at 10,000 files / 2 MiB each / 50,000
  occurrences and run on `spawn_blocking`.
- Two namespaces: document `label` and bibliography `citation`. Diagnostics cover
  duplicate definitions, missing usages, unused definitions, unresolved Typst
  `@key`, and the honest ambiguous case where a Typst key exists as both label
  and bibliography entry. Truncated indexes suppress unsafe unused conclusions.
- LaTeX covers label/ref variants, multi-key `cref`/citations, comments, verbatim,
  `lstlisting`, `minted`, and `verb`. BibTeX excludes comment/string/preamble.
- Typst uses the real `typst-syntax` AST for `<label>`, `@key`, `ref(...)`, and
  variadic `cite(...)`; comments, raw content and strings are therefore not
  guessed with regex. `label("x")` is correctly treated as a value constructor,
  not a document definition.
- Markdown is intentionally narrow: headings/explicit anchors, local fragment
  links, Pandoc citations and Quarto fig/tbl/eq/sec/lst references, excluding
  fenced and inline code.

### Navigation, citation UX and safe rename

- Sidebar References panel shows issues plus symbols; symbols jump to definition
  and expand to all definition/reference locations (go-to-definition + find
  references from one index). Stale async results are generation-gated.
- Bibliography is no longer LaTeX-only: `.bib` paths also come from the unified
  index, and insertion uses `\cite{key}` / `@key` / `[@key]` for LaTeX / Typst /
  Markdown respectively.
- Rename Label or Citation Key previews affected files and exact occurrence
  counts. It refuses collisions, dirty Documents, truncated indexes, generated
  Markdown slugs and escaped Typst strings. Apply rechecks every preview
  fingerprint, re-indexes disk state, stages same-directory files, preserves
  permissions, and rolls back on partial installation failure. Tests cover a
  single citation-key rename across LaTeX, Typst, Quarto and BibTeX.

### Review findings fixed

1. Typst initially used a hand scanner despite `typst-syntax` already exposing
   real Label/Ref nodes; it was replaced with AST traversal.
2. `#ref(<x>)` child labels could be misclassified as definitions.
3. Bare unresolved `@key` was initially biased toward label instead of diagnosed.
4. LaTeX multi-key refs and repeated cite keys needed distinct exact ranges.
5. Typst variadic cite could accidentally index named string options.
6. `label("x")` is a constructor, not an attached document definition.
7. Citation insertion symmetry test caught a missing LaTeX backslash.
8. Bibliography UI was made visible to Typst but still read only LaTeX Project
   files; its data source now also uses the unified index.
9. Rename apply initially re-indexed before checking preview fingerprints, making
   stale errors indirect; it now validates preview files first.
10. Open-Document refresh had to finish before rebuilding the post-rename index.

**Verified:** 64 Rust + 361 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. GUI verification
remains for sidebar density, native confirmation flow, and multi-file rename in a
real LaTeX/Typst/Quarto workspace. The index refresh is explicit/on-workspace-open
for now; this is not claimed to be a live language server.

---

## 0. Update - 2026-08-05 (bounded Workspace Search and conflict-safe Replace All)

Workspace-wide text search/replace is implemented behind a bounded Rust module
(`src/workspace_search.rs`) and a `Ctrl/Cmd+Shift+F` dialog.

- Literal/regex and case-sensitive search; clickable path/line results. Rust's
  linear-time regex engine is used, never JavaScript backtracking regex.
- The scanner skips VCS/build/dependency/venv directories, does not follow
  symlinks, ignores binary/non-UTF-8 files, and caps at 10,000 files, 2 MiB per
  file, 5,000 matches and 4,096 query bytes. Blocking disk work runs on
  `spawn_blocking`, not the Tauri event loop.
- Every match carries a content fingerprint. Replace All validates every selected
  file before writing and rechecks after staging; an external edit aborts the
  whole batch before installation. Open dirty Documents also block replacement.
- Cross-platform same-directory staging/backups support Windows (where rename
  cannot overwrite an existing file), preserve permissions, and roll back
  already-installed files if a later installation fails.
- Literal replacement uses `NoExpand`, so `$1` stays literal; capture expansion
  is enabled only for regex searches. Truncated searches cannot Replace All.

Review found and fixed: sync filesystem scanning on the UI runtime, Windows
rename-over-existing failure, literal `$` expansion, dirty open Document
overwrite, naive Windows path comparison, and Replace All on incomplete results.

**Verified before commit:** 47 Rust tests (including 6 workspace-search tests)
and 358 frontend tests pass; typecheck/build, `cargo check --all-targets`, and
`git diff --check` are clean.

---

## 0. Update - 2026-08-05 (trusted Project Tasks, streaming output, cancellation, and Project Doctor)

The first executable research-workflow slice is complete. Tasks declared in
`clavis.toml` now appear in the command palette for trusted workspaces and can
run dependency graphs for R/Python/Quarto/latexmk or any installed CLI.

### Execution model and safety

- New deep Rust module `src/tasks.rs`: dependency planning, one active run,
  direct argv process launch (**no shell**), confined/canonicalized `cwd`, env,
  per-step timeout (default 15 minutes, configurable 1?3600 seconds), streamed
  stdout/stderr events, process-tree cancellation, and bounded output draining.
- Configuration and trust are re-read immediately before every run, closing the
  open-workspace/start-task TOCTOU gap. Backend state atomically rejects a second
  concurrent run even if two frontend requests race.
- macOS/Linux GUI PATH enrichment is shared by Doctor and execution so Finder-
  launched apps can find Homebrew CLIs; workspace-relative executables are also
  supported.
- Switching or closing a workspace while a task runs requires confirmation and
  cancellation. App shutdown cancels all tracked task runs.

### Frontend and Doctor

- New task store subscribes before the start IPC (so immediate output cannot be
  missed), filters events by run ID, caps output at 10,000 lines, exposes Stop,
  and reports dependency order/current step/final status in `TaskPanel`.
- Every configured task registers a `Run project task: <name>` command.
- `Run Project Doctor` checks config validity, main-document existence, trust,
  command availability, and task working directories in a dedicated dialog.
- Domain language for Project Task, Task Run and Workspace Trust is recorded in
  `CONTEXT.md`; README documents execution and optional fields.

### Review findings fixed before commit

1. Task commands initially did not subscribe to async workspace inspection, so
   they could remain absent until an unrelated re-render.
2. Closing/switching a workspace could orphan its running process.
3. Frontend single-run checks were insufficient: two IPC starts could race; the
   backend now reserves the active slot atomically.
4. Child descendants can inherit stdout pipes after the parent exits; drain now
   has a 2-second bound and aborts stuck readers.
5. Doctor and runtime originally used different PATH semantics on macOS.
6. A frontend listener test initially cleared process-lifetime listeners between
   cases; the fixture was corrected to model the real app lifecycle.

**Verified:** 41 Rust + 358 frontend tests pass; frontend typecheck/build,
`cargo check --all-targets`, and `git diff --check` are clean. Real-window
verification remains advisable for cancellation of R/Quarto child processes and
the native Workspace Trust dialog.

---

## 0. Update - 2026-08-05 (project configuration and Workspace Trust foundation)

The first research-workspace infrastructure slice is implemented. An optional
repository-owned `clavis.toml` can now describe project metadata, LaTeX defaults,
generated/ignored paths, and a dependency graph of tasks. **No task execution is
implemented in this slice and opening a workspace never runs a command.**

- New deep Rust module `src/project_config.rs` owns canonical workspace identity,
  the 256 KiB config limit, TOML parsing, path confinement checks, unknown task
  dependency checks, cycle detection, and trust persistence.
- Trust is deliberately stored outside the repository in the Clavis user config
  directory. A checked-in `clavis.toml` cannot mark itself trusted.
- New IPC seam: `inspect_workspace(root)` and
  `set_workspace_trust(root, trusted)`. The frontend orchestration asks exactly
  once when a valid config contains executable tasks; invalid configs and
  task-free configs never request trust.
- Folder open/drop/recent-folder flows now inspect project metadata and retain it
  in the project store. Declining trust still opens the folder normally.
- `depends_on` remains the idiomatic TOML spelling while IPC emits `dependsOn`; a
  failing Rust test caught the initial serde mismatch before integration.
- README documents the format and explicitly says commands are not yet launched.

Verification for this slice: 6 focused Rust project-config tests and 5 frontend
trust-orchestration tests pass. Full-suite verification is recorded immediately
before commit.

---

## 0. Update - 2026-08-05 (Typst completion rebuilt on the real stdlib, plus a signature tooltip)

Two related features, both driven by typst's own parameter metadata:

1. **Typst function completion** now comes from the standard library instead of an
   82-entry hand-written list — 391 functions, with real parameter names and
   idiomatic call shapes.
2. **A parameter signature tooltip** (LSP `signatureHelp`, not completion): a
   cursor-following panel listing the enclosing call's parameters with the active
   one highlighted. Covers Typst builtins, Typst `#let` functions, and LaTeX
   commands.

**Working state:** 28 Rust + 349 frontend tests green; `cargo check
--all-targets`, `npm --prefix web run typecheck`, `npm --prefix web run build`
all clean. A release build was produced successfully
(`Clavis_1.0.5_x64-setup.exe`, 13.55 MB). **Uncommitted**, and sitting on top of
the also-uncommitted keyval fix below — they are separate concerns and should be
two commits.

### The finding that shaped the design

**`typst-ide` has no signature-help function** — not in 0.11, not in 0.15. Its
whole public API is `autocomplete`, `tooltip`, `jump_*` and `analyze_labels`.
typst.app's parameter hints are not a library call, and tinymist does not use
`typst-ide` at all (it reimplemented everything, including a type checker).

So both features are built from `Func::params()`, the metadata the `#[func]`
macro bakes into the binary. Consequences worth keeping:

- **No `typst-ide` dependency was added.** It would buy nothing.
- **No typst upgrade needed.** We are on **0.11.1**; upstream is at **0.15.1**
  (2026-07-17), four releases ahead. `Func::params()` exists in both. Upgrading
  is a separate and non-trivial job: 0.15 changes `autocomplete` to take
  `&dyn IdeWorld`, moves `ParamInfo` out of `typst::foundations`, and turns
  `params()` into an iterator.
- **`#let` functions cannot come from Rust.** `func.rs` has
  `Repr::Closure(_) => None`, so closures expose no parameters at all. They are
  parsed out of the document instead, and the honest cost is that custom
  functions show parameter *names and defaults but no types* — typst infers those
  at compile time, and reproducing that means a type checker.

### Architecture: position logic in TS, Rust supplies a static table

The tooltip refreshes on **every cursor move**, so an IPC round trip per
keystroke was never viable. Builtin signatures are compile-time constants, so
Rust dumps the whole table once and the frontend caches it for the session —
measured at **391 functions / 239 KiB JSON**. Keeping all offset arithmetic in TS
also sidesteps the UTF-8 (Rust) versus UTF-16 (JS) offset hazard entirely.

New files: `src/typst_sig.rs`; `web/src/completions/{callSite,signatures,typstLetScan,typstProvider}.ts`;
`web/src/editor/signatureTooltip.ts` (plus a test file each, and
`popupIntegration.test.ts` — see below for why that one exists).

### Call shapes: the part that was wrong twice

First attempt generated `#emph()`. Typst writes `#emph[...]`, and the rule is in
the spec: *"An arbitrary number of content blocks can be passed as trailing
arguments to functions. That is, `list([A], [B])` is equivalent to
`list[A][B]`."* So `callTemplate` now puts a **trailing `content`-typed positional
parameter in a bracket**, keeping anything before it in parens:

    emph      body!P:content                 → #emph[${1:body}]
    link      dest!P:str, body!P:content      → #link("${1:dest}")[${2:body}]
    list      children!PV:content             → #list[${1:children}]
    calc.pow  base!P, exponent!P              → #calc.pow(${1:base}, ${2:exponent})
    pagebreak (nothing required)              → #pagebreak()

Two exceptions that metadata alone gets wrong, both verified against the docs:

- **`figure`** is `PAREN_BODY_FUNCTIONS`. Its body *is* content-typed, but every
  upstream example writes `#figure(image("a.png"), caption: [..])` — the body is
  an image, not prose.
- **Math mode suppresses brackets entirely.** `frac`'s parameters are also
  `content`, yet it is written `$ frac(x, y) $`, never `frac(x)[y]`. Content
  blocks are markup syntax.

### Ranking, and the math/markup split

A dump of the real 434-candidate list for a bare `#` showed the first 40 entries
were pure alphabet **and full of math functions**: `#alpha`, `#beta`, `#binom`,
`#frac`, `#integral`, `#kappa`. Meanwhile `#heading`, `#text` and `#table` were
nowhere. `#frac(a, b)` in markup does not compile, so this was wrong, not just
badly sorted.

Fixes:

- `FuncSig.math_only` in Rust, set by comparing the `global` and `math` scopes.
  **40 functions exist only in math.** The frontend filters them out of markup and
  drops the `#` inside `$...$` (`inTypstMath` — a Typst-specific scan, because
  `mathContext.ts` is LaTeX-only: `%` comments and `\(`/`\[`).
- The curated snippets in `snippets.ts` gained a `math?: true` flag for the same
  reason: hash-prefixing them wholesale had started offering `#alpha` in markup.
- Boosts are now four interleaved tiers, documented in `typstProvider.ts`. The
  non-obvious part: `heading`, `text` and `par` have **no** curated snippet, so
  "curated always beats generated" would bury the most common functions under
  `#circle`/`#ellipse`. Both providers therefore split on the same
  `isCommonTypstName` predicate.

Result for a bare `#`: `#align #block #box #cite #emph #figure #footnote #image
#link #ref …`; inside `$...$`: `abs binom cases frac integral mat …`, no hash.

### Three bugs that only a boundary test could catch

The provider suite was green while the popup showed nothing. **CodeMirror filters
`option.label` against `state.sliceDoc(from, to)`**, and our completion site
starts at the `#` — so a `figure` label never matches a `#figu` pattern and is
dropped *after* the provider returns it. Both providers now hash-prefix their
typst labels, which also makes them collide so `mergeCandidates` can pick the
curated one.

`popupIntegration.test.ts` exists specifically to cross that boundary: it drives
the real `buildCompletionSource` and replays CM6's own filter. It was written
failing (`#figu` → 0 candidates, `#` → 17) and is the only test in the suite that
would have caught this.

The same file pins a second failure mode: **completion is synchronous, so the
first request only starts the IPC fetch.** LaTeX already solved this with
`prefetchCwlForDocument` on tab switch (`EditorPane.tsx`); the Typst equivalent
was missing, which is why the first `#` showed 17 entries. `prefetchTypstSignatures`
now mirrors it.

Third: **O(n²) call-site scanning.** `calleeBefore` did `text.slice(0, i)` per
delimiter; 50k open parens took 267 ms for one cursor move. Bounded by
`LOOKBEHIND`, with a timing test guarding it.

### Other things measured rather than assumed

- **Nested scope recursion triples coverage.** A flat walk of `global`/`math`
  finds 126 functions; recursing one level into function, module and type scopes
  (`table.cell`, `calc.pow`, `array.map`) reaches **394**. Depth is fixed at one
  because typst nests no deeper, which also means no cycle detection.
- **Docs had to be truncated.** Full `ParamInfo::docs` Markdown is ~145 KiB
  versus ~64 KiB for first sentences. `first_sentence` approximates `typst-ide`'s
  private `plain_docs_sentence`.
- **`CastInfo` has no `Display` in 0.11**, so `render_type` is ours. Unions are
  flattened with `walk` and capped at 6 alternatives — some params accept every
  named colour.
- **No CSS or new dependency was needed for the tooltip.** `EditorPane.module.css`
  sets `overflow: hidden`, which looked like it would clip the panel, but
  CodeMirror tooltips default to `position: fixed`. `@codemirror/autocomplete`
  publishes its popup through the *same* `showTooltip` facet, so `above: true` is
  what keeps the two from colliding.
- **A `%` comment breaks LaTeX argument grouping** unless stripped:
  `\frac{a}% note\n{b}` is one command with two arguments, because TeX discards
  the comment.

`callSite.ts` also inherits the lesson from the keyval bug below: every scan
starts from a blank line or a hard character budget, so an unclosed delimiter can
never claim the rest of the document.

### Still to verify in a real window

Unit and static verification only — the sandbox has no display. A release build
was installed and the completion list was checked by hand, which is how the
`#emph()` and "only 17 entries" defects were found; the list below is what a
fresh pass should confirm.

- `#emph` / `#strong` / `#link` insert bracket forms.
- A bare `#` starts with authoring verbs and contains no `#alpha` / `#frac`.
- `$ fr` offers `frac` with no `#`.
- `#figure(` shows the tooltip; `caption` highlights after `caption:`; the panel
  and the completion popup do not overlap.
- `\frac{` shows `num`/`den` and advances to `den` after `}{`.
- A custom `#let f(a, b: 1)` shows `a` and `b = 1`, tagged `(local)`.

### Known gap, not started

`#set` / `#show` have no dedicated completion. `#set` takes only settable
parameters and `#show` has a selector-then-function shape; today there are just 8
hand-written `#set` templates, and the 391-function table is not adapted for
either position.

---

## 0. Update - 2026-08-05 (keyval site misdetection killed the completion popup)

Review of the previous session's commit (`8894c3a` "Fix LSP funcs") found that
the new keyval completion silently disabled the popup in ordinary maths.
Frontend-only, no Rust changes.

**Working state:** `npm --prefix web test` = 234/234 (225 before + 9 new),
typecheck clean, `npm run build` succeeds.

### The bug: an unclosed `[` swallowed completion entirely

`\left[ ... \right]` is ordinary maths, and **completion was dead for the whole
span** until the closing `\right]` was typed. Same for `\item[term` in a
description list.

The chain, which is the part worth remembering:

1. The keyval regex body was `[^[\]]*` — no newline exclusion, no length bound.
   So *any* unclosed `[` to the left claimed every position after it.
2. The keyval branch runs **before every other LaTeX site**, so the misdetection
   won over the command/word sites that should have handled those positions.
3. No provider answers a keyval site it has no keys for: `latexSemanticProvider`
   hits its `default`, `snippetProvider` filtered everything out, and
   `cwlProvider` found no `#keyvals:` for `\left` (verified — the corpus has
   none for `\left` or `\item`).
4. `engine.ts` ends with `if (candidates.length === 0) return null`, and null
   means **no popup at all** — not "fewer candidates". A silent failure.

The lesson generalises past this one regex: **site detection order plus an empty
candidate list equals a disabled feature.** Any future site added ahead of the
general ones needs the same scrutiny.

### The fix, in the order it matters

1. **`engine.ts` retries.** If a keyval site produces zero candidates, the
   engine re-detects with keyval suppressed (new `skipKeyval` param on
   `detectCompletionSite`) and runs the providers once more. This is the safety
   net: any *future* misdetection costs one extra pass instead of the popup. It
   was verified to work in isolation — with the old regex deliberately restored,
   the "still completes inside `\left[`" test passed on the fallback alone.
2. **Regex tightened** (`keyvalSite` in `context.ts`, extracted alongside
   `argumentSite`): body excludes `\r\n`, and the last comma-separated segment
   must look like an option key (`/^[A-Za-z][\w-]*$/`). This rejects
   `\left[ \frac`. It cannot reject `\item[Ter` — shaped exactly like a real
   option list — which is precisely why step 1 is required, not optional.
3. **Two latent bugs fell out of the rewrite.** `query` was the *whole* bracket
   body, so a second option never matched (`[width=5cm,he` was looked up
   verbatim); it is now the segment after the last comma. And typing a *value*
   (`[width=.5\textw`) now falls through to the command site, so `\textwidth`
   completes there.

### Also fixed: `classCandidates` rank inversion (same commit)

`article` sank below all 27 `class-a*` files the moment the user typed `a`. The
`continue` above already filters non-matches, so the old
`!!q && cls.startsWith(q) ? 10 : 0` was a tautology at 10 while `KERNEL_CLASSES`
got 5. Kernel classes now get 20, everything else 0. **This is the second
rank-inversion of the same shape** (see `a690fa6`); the pattern to watch is a
boost expression re-testing a condition an earlier `continue` already
guaranteed. The dead `prefix` variable in `packageCandidates` (identical
tautology, no ordering effect) was removed too.

`snippetProvider` now lists `package`/`class`/`keyval` in an explicit
`NON_SNIPPET_SITES` set. It returned nothing for them anyway, but only because
all 25 LaTeX snippets happen to start with `\` — a coincidence, not a contract.

### Verified by test, not by inspection

Every new test was confirmed to **fail against the old code** before being kept
(old regex restored temporarily: 5 site-detection failures; old boost restored:
1 failure). Tests asserting rank check `boost` rather than array position,
because `completeSettled` returns raw provider output — ordering is applied
later by `mergeCandidates`.

### Still to verify in a real window

Everything below is static/unit-verified only; the sandbox has no display.

- `$\left[ \fra` → popup appears (this was the user-visible bug).
- `\documentclass{a` → `article` sits first.
- `\usepackage[` and `\includegraphics[wi` → options still appear (no regression).
- `\includegraphics[width=5cm,he` → `height` offered; `[width=.5\textw` →
  `\textwidth` offered.

### Confirmed correct from the previous session (no action needed)

- **Tab accepting completions.** Checked against
  `node_modules/@codemirror/autocomplete@6.20.2`: `completionKeymap` really does
  bind Enter only, so the added Tab bindings and the `indentWithTab`-last
  fall-through order are right.
- **Theme selection changes** in `controller.ts` — untouched.

---

## 0. Update - 2026-08-04 (completion UX: Tab accepts, package/class/keyval argument completion, selection highlight)

Three user-facing fixes, frontend-only. **Uncommitted on `main`** (per repo rule,
HANDOFF updated in the same push).

**Working state:** `npm --prefix web test` = 224/224 (206 before + 18 new),
typecheck clean, `npm run build` succeeds. No Rust files changed. Corpus
verification against the real 4465-file corpus: 235,956 commands / 8,800
environments / 35 dropped — unchanged — plus newly parsed **16,569 `#keyvals:`
blocks (402,186 option keys across 7,368 commands)**.

### 1. Tab now accepts an open completion

Root cause: `@codemirror/autocomplete@6.20.x` `completionKeymap` binds **Enter
only** — Tab never accepted. `web/src/editor/keymaps.ts` now prepends
`{ key: 'Tab', run: acceptCompletion }` then the snippet-field bindings
(`{ key: 'Tab', run: nextSnippetField, shift: prevSnippetField }`), with
`indentWithTab` last as the fallback. Each `run` returns false when its state is
absent, so a plain Tab still indents when there is no popup/snippet.

### 2. Argument-site completion: package / class / keyvals

TeXifier-style two-level completion. `\us` → `\usepackage` now inserts the bare
command (`\usepackage{${1}}`, cursor in the braces) instead of the corpus
placeholder template `\usepackage[options%keyvals]{package}` — `ARG_ONLY_COMMANDS`
(`usepackage`, `RequirePackage`, `documentclass`) overrides the snippet in
`commandCandidate` (`cwlProvider.ts`).

- `context.ts`: new sites — `\usepackage{`/`\RequirePackage{` → `package`,
  `\documentclass{` → `class`, and inside open optional brackets
  (`\includegraphics[wi`, `\begin{Form}[t`) → `keyval` (with `command`).
  `\[` display-math cannot match the keyval pattern (verified by test).
- `cwlProvider.ts`: `package` candidates from `availableNames` (the existing
  `list_cwl_packages` Rust command — zero Rust changes), excluding `class-*` /
  `latex-document`; `class` candidates from `class-*.cwl` stems; `keyval`
  candidates from the `#keyvals:` blocks of packages the document loads.
  Prefix matching (startsWith), ~45 curated common packages boosted to top.
- `cwlParser.ts`: `#keyvals:` blocks now parsed (multi-command comma headers,
  `/pkg` qualifiers, `#c` classification tails) into `CwlKeyvals` on each
  `CwlPackage`. Bodies are still not command lines, so nothing leaked into
  commands; corpus drop count unchanged at 35.

### 3. Selection highlight is visible again

`BUILTIN_THEMES` selection colours brightened across dark themes (github-dark's
semi-transparent `#264f7833` → opaque `#1f4e79`; dracula/material/one-dark/nord
all lifted), and `.cm-selectionBackground` gained a 1px accent outline
(`withAlpha(accent, 0.55)`). `::selection` and `.cm-selectionMatch` keep the
plain fill. Users can still override via `editor_theme_overrides.selection`.

### Still verify manually (headless sandbox)

- `tauri dev`: `\us` → Tab/Enter accepts → cursor lands in `{}` → package list
  pops automatically (depends on CodeMirror re-triggering after snippet apply;
  if it does not, add a `startCompletion` dispatch to the `\usepackage` apply).
- Tab accepts while popup open; Tab still indents with no popup; Tab jumps
  snippet fields after accepting `\begin{document}`; Shift-Tab goes back.
- `\usepackage[` after `\usepackage{graphics}` offers `draft`/`final`/…;
  `\documentclass[` offers `a4paper`/`11pt`/…; `\includegraphics[` offers
  options only when the owning package is loaded.
- Selection box outline is per-line (CodeMirror paints one rect per line) —
  check it does not look like a fence; drop the outline if so.

### Follow-up fix after real-window report ("documentclass has no candidates")

User reported `\documentclass{` offering nothing. Static verification showed the
whole chain was fine (site detection, provider, Rust `list_cwl_packages`
registered and returning 4465 stems, resources present in
`target/debug/resources/cwl` — dev `resource_dir()` resolves to the exe dir,
i.e. `target/debug/`, so `resolve_resource("resources/cwl")` = that folder,
repopulated by tauri-build on each build). Two real weaknesses found and fixed:

1. **`availableNames` failure was permanent.** A single failed
   `list_cwl_packages` IPC set the list to an empty Set forever, silently
   killing package/class completion for the session. Now a failure leaves the
   cache null and retries after a 10 s cooldown (`nextListAttemptAt`); success
   resets it. `resetCwlCacheForTests` clears the cooldown.
2. **Argument-only apply relied on CodeMirror auto-reactivation.** Accepting
   `\usepackage`/`\documentclass` (snippet `\name{${1}}`) re-runs the
   completion source after the `input.complete` transaction in theory, but
   users could land in the braces with no popup. New `reopenCompletion` flag on
   the candidate: `source.ts` `buildApply` wraps the snippet apply and calls
   `startCompletion(view)` right after, so the package/class list appears
   immediately. Also note: the corpus has **no `class-article.cwl`** — article
   is genuinely absent from TeXstudio's files (402 `class-*` files, beamer
   present); that is data, not a bug.
3. **Kernel classes are now always offered.** article (and `minimal`) have no
   `class-*.cwl` because their commands live in latex-document.cwl, so the raw
   stem list omits them. `classCandidates` now merges a `KERNEL_CLASSES`
   whitelist (`['article', 'minimal']`, boosted 5) with the `class-*` stems;
   book/report/letter/slides/proc already have files and dedupe cleanly.

A likely confounder: the user's report matches the **old build**
(`\usepackage[options%keyvals]{package}` insert and faint selection are both
pre-change behaviour). Rebuild the frontend and retest before chasing further.

---

## 0. Update - 2026-08-04 (LaTeX completion now backed by the TeXstudio `.cwl` corpus)

**Working state:** on `main`. Phases 1 and 2 are committed along with a review
pass; the only uncommitted work is the fetch-script rewrite described below.
206 frontend tests + 21 Rust tests green, `npm run typecheck` and
`cargo check --all-targets` clean. **v1.0.5 is built and published.**

**Verified in a real window** (`npm --prefix web exec tauri dev`): package-aware
loading and math-mode filtering both behave. Two things bit during that session,
both worth remembering:

- **`npm run dev` alone is not enough.** That serves the frontend in a browser
  tab, where `window.__TAURI__` is absent, so every `.cwl` read is skipped and
  LaTeX completion collapses to the ~30 kept `\begin{...}` skeletons. It looks
  exactly like a broken feature. Use `tauri dev`.
- **`\binom` is not a base command.** It lives in `amsmath.cwl` and is `#m`, so
  it needs both `\usepackage{amsmath}` *and* a math context. `\frac` and `\sqrt`
  are in `latex-document.cwl` (also `#m`) and are the better smoke test for
  math filtering alone.

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

- `tools/fetch-cwl.mjs` — partial + sparse clone of `completion/` only, with
  retries. See "Fetch rewrite" below for why it is not a tarball any more.
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

### Fetch rewrite — partial clone instead of a tarball

The first version streamed `codeload.../tar.gz/<commit>` and parsed tar inline.
It worked locally and then **aborted mid-download on a CI runner**
(`cwl: The operation was aborted`), which would have failed the next release at
random. Root cause was not the network: the script moved **115 MB to obtain 11 MB
of data**, because a tarball has no resolution short of "all of it", and it had
neither a timeout nor a retry.

Now it does a partial + sparse clone of `completion/` alone. Measured:
**115 MB → 6 MB transferred**, ~80s → ~50s, same 4465 files, output verified
**byte-identical** to the tarball version. Plus 3 retries with linear backoff and
a 5-minute per-attempt timeout.

Two things this deleted, worth knowing they are gone:

- **The hand-rolled tar parser.** It was its own hazard — it silently dropped 11
  files whose paths exceed 100 bytes until the ustar `prefix` field (offset 345)
  was handled, and the only symptom was a slightly lower file count. Git does
  this now. The `expectFiles` tripwire in `cwl-version.json` stays as the guard
  against any future silent shortfall.
- **Platform-dependent output.** The first partial-clone attempt produced 497
  files differing from the tarball run — all CRLF-vs-LF, because git's
  `core.autocrlf` rewrites line endings on Windows checkouts. Content was
  identical and the parser splits on `/\r?\n/`, so nothing was broken, but the
  same pinned commit yielding different bytes per platform is a trap for whoever
  next diffs two machines. The clone now forces `core.autocrlf=false` and
  `core.eol=lf`.

New requirement: **`git` must be on PATH**. Every CI job that runs this already
checks out with git, so this costs nothing in practice.

### Debugging notes worth keeping

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

### Phase 2 — context filtering (done)

`web/src/completions/mathContext.ts` decides whether a position is math mode, so
the corpus's `#m` / `#n` / `#t` / `/env` classifiers can be enforced. Measured
effect on a 5-package document: **1203 commands → 810 offered in prose, 1172 in
math**, i.e. 362 math-only commands correctly suppressed while writing text.

Design points that matter if you touch it:

- **Bounded scan, not full document.** It walks forward from the nearest anchor
  above the cursor. A blank line is the strongest anchor because TeX itself
  forbids one inside `$...$`, so math cannot leak past it; `\begin{document}` and
  a closing math `\end{}` work too, with a 500-line ceiling as backstop. There is
  a perf test asserting <5 ms per call on a 20,000-line document — an unbounded
  version would stall typing in a long file.
- **Biased toward text when unsure.** A false "math" verdict hides `\textbf` and
  every other text command, which is far more disruptive than showing a few
  surplus math operators in prose.
- Handles `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, math environments incl. starred
  forms, `\text{...}` islands back to text mode, escaped `\$`, and `%` comments.

**`#*` is downranked, never hidden.** It covers a quarter of the corpus and
includes genuinely useful commands (`\addcontentsline`, `\arabic`, `\Alph`);
TeXstudio only tucks them behind an "all" tab. `#S` is the flag that really means
invisible, and the parser drops those. `cwl_show_unusual` promotes `#*` to normal
rank rather than revealing anything new.

Three settings ride on the existing `#[serde(flatten)] extra` mechanism, so
`settings.rs` needed no change: `cwl_enabled`, `cwl_show_unusual`,
`cwl_respect_context` (the last is an escape hatch for diagnosing a command that
should appear but does not). They are pushed into the provider via
`setCwlOptions` from `EditorPane`, because `complete()` is synchronous and on the
keystroke path.

### Review pass — two real bugs found

- **Rank inversion.** `cwlProvider` shipped at boost 2 while `snippetProvider`
  gives its entries boost 1, and `mergeCandidates` keys on label alone — so the
  bare corpus stub (`\begin{itemize}`, name only) *outranked* the hand-written
  skeleton it was supposed to defer to. Inserting an environment produced no
  `\item`. `BOOST_NORMAL` is now 0. `engine.test.ts` pins the ordering in both
  provider orders; nothing had tested cross-provider precedence before, which is
  exactly why this slipped through.
- **Classifier false positive.** The hidden-flag test ran against the raw
  classifier (`/(^|[^a-zA-Z])S/`), so a command restricted to an environment
  named with a capital S (`#/Sidebar`) would have been dropped entirely. No such
  env exists upstream today, but the corpus grows. Flags now read only the letter
  section, with `*` tracked separately since it is punctuation and was never in
  `CLASSIFIER_LETTERS` (making the old `letters.includes('*')` dead code).
  Corpus-wide counts are unchanged after the fix — 235,956 commands, 8,800
  environments, 35 dropped — confirming no existing behaviour moved.

Claims investigated and **refuted**, recorded so they are not re-chased: the
`textEscapeBraces` double-assignment is harmless (the first `}` does exit text
mode — the assignment happens before the loop reaches the brace), and the
module-level caches do not leak across tabs (the package-scan memo is keyed on
document text, and a test now covers A→B→A switching).

### History was rewritten on 2026-08-04 — old hashes are dead

Every commit from `04bfa4a` (2026-07-10) onward was rewritten to strip
`Co-Authored-By: Claude ...` trailers, because GitHub parses that trailer and
listed Claude as a repository **contributor** on the public repo page. `main` and
all six tags `v1.0.0`–`v1.0.5` were force-pushed.

Practical consequences:

- **Pre-rewrite hashes no longer resolve.** The v1.0.5 Release is tied to
  `eb16f15`, so its commit link 404s. A stale clone needs `git fetch --tags -f`
  plus a reset.
- **Published Release assets were unaffected.** Installers and `latest.json` are
  stored independently of git, so downloads and in-app updates kept working.
- **Two traps hit while doing this.** The first filter used
  `grep -v "^Co-Authored-By"` and missed an older commit where the trailer was
  appended *to the subject line* rather than standing alone — a `sed` over the
  whole message caught it. Then `git push -f origin --tags` pushed the safety
  backup tag too, re-publishing the exact commits being removed; delete the
  backup before pushing tags, or push tags by name.

Do not add AI co-authorship trailers to commits in this repo.

### Still unverified (manual, off-sandbox)

- **`web/tsconfig.json` excludes `cwlCorpus.test.ts`, and the reason is a trap.**
  That file reads `resources/cwl/` with `node:fs`, but the project has no Node
  types — `types` is pinned to `vite/client` and `@types/node` is not a
  dependency. It typechecked locally purely by accident: TypeScript walks parent
  directories looking for `node_modules`, and a stray
  `C:\Users\<user>\node_modules\@types\node` *above the repo* satisfied the
  imports. CI has no such parent, so it failed there and passed here.

  Worth internalising: **`npm ci` and `tsc --force` do not reproduce this** —
  both were tried, both passed, because the difference is outside the repo
  entirely. `npx tsc --explainFiles` is what found it, printing the resolved
  path as `../../node_modules/@types/node`. If a type error appears only in CI,
  suspect resolution from above the repo root before touching dependencies.

  Cost: type errors inside that file are caught nowhere. Vitest still runs it
  (esbuild, no type check), so coverage is unaffected — keep it thin and leave
  logic in the modules it exercises.

- **v1.0.5 shipped, but from the pre-rewrite history.** The Release was built and
  published with 13 assets across all three platforms, and its Windows installer
  grew 12.01 → 13.51 MB versus 1.0.4 — a +1.50 MB delta that matches the measured
  ~1.7 MB compressed corpus, so the `.cwl` files really are inside the bundle.
  Note the Release is tied to commit `eb16f15`, which no longer exists after the
  history rewrite (see below), so its commit link 404s.

  Three CI gates were hit in sequence getting there, all working as designed:
  `check_release.py` (tag created before the version bump was committed, so the
  tagged tree still said 1.0.4), `check_handoff.py` (every repository change needs
  a HANDOFF edit in the same push — including a one-line tsconfig fix), and then
  the tarball download abort that prompted the fetch rewrite. The ordering in
  RELEASING.md §3 exists precisely to avoid the first two.

- **Bundle size / startup on a real build.** Corpus is ~10 MB raw, ~1.7 MB
  compressed. Nothing is parsed until a package is referenced, so startup should
  be unaffected, but that was never measured on a packaged app.

- **The packaged resource path is the biggest untested link.** `tauri dev` reads
  `resources/cwl/` straight out of the repo, so the dev verification proves
  nothing about a real installer. Whether
  `app.path_resolver().resolve_resource("resources/cwl")` (`src/cwl.rs:50`)
  lands correctly inside an NSIS/DMG/AppImage bundle has never been exercised —
  it needs a full `tauri build`, which the sandbox cannot do. **If it resolves
  wrongly, an installed app shows only the ~30 kept `\begin{...}` skeletons** —
  the same symptom as running in a browser tab, and easy to misread as the
  feature being broken. Install the first 1.0.5 artifact and check that `$\fra`
  offers `\frac` before publishing the draft to anyone.
- **Browser mode degrades silently.** With no Tauri runtime, completion falls
  back to the kept skeletons with no indication why. Fine for the shipped app,
  confusing for anyone running `npm run dev` alone.
- **No settings UI, and deliberately so.** The three `cwl_*` toggles work but
  have no controls in `SettingsDialog.tsx`. Decided against adding them: two are
  near-useless (`cwl_enabled` off just disables the feature, `cwl_show_unusual`
  is a fringe preference) and the third, `cwl_respect_context`, is a diagnostic
  escape hatch that only matters if math detection misjudges something — which
  real-window testing did not show. If a misdetection does turn up, fixing the
  detection beats exposing a switch to work around it. Editing `settings.json`
  remains available for debugging.

### Deferred

`#keyvals:` key/value completion (`\includegraphics[width=…]`), `L0`–`L5`
structure levels wired into the existing outline, environment aliases beyond the
math ones, and a TexLab/LSP adapter (still the long-term option; note TeXLab is
also GPL-3.0).

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
