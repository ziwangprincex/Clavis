# Clavis — Handoff (2026-07-10)

A working-state handoff so the next session (or a future you) can pick up cold.
Written after a large multi-feature push. **The headline fact: a big batch of
work is done and verified but NOT yet committed — see §2.**

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

## 2. ⚠️ Git state — READ FIRST

- Branch: **`p0-guardrails`** (name is historical; it now contains P0–P3 work).
- **4 commits** ahead of `origin/main` and pushed (last: `cd20c05` CI pin).
- **~36 files of UNCOMMITTED work in the working tree** + new untracked files.
  This is the entire session below (multi-file features, 14 bug fixes, IPC
  types, GUI/apple-design, auto-update, tabbed settings). **All verified green
  but never committed.** Committing this is the immediate next task.

### Before committing — ignore tooling artifacts
These untracked paths are **Claude Code / skill tooling, NOT project source** —
add to `.gitignore` (was in progress, may already be done):
```
.agents/
.claude/
skills-lock.json
```
Also note: persistent **CRLF warnings** on Windows inflate the diff stat
(insertions/deletions look huge because line endings re-write whole files). A
`.gitattributes` with `* text=auto eol=lf` would fix this permanently — not yet
done.

### Suggested commit grouping (work is logically separable)
1. Multi-file LaTeX features (F1–F4) + their bug fixes
2. IPC strict typing + diagnostics multi-file mapping
3. Recent-folders / remove-default-3-tabs
4. GUI polish + apple-design pass
5. Auto-update (updater config, CI, RELEASING.md)
6. Tabbed settings dialog

---

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

## 4. Auto-update — UNFINISHED, needs the user's manual steps

Code/config is in place (`tauri.conf.json` updater block, `Cargo.toml` `updater`
+ `process-relaunch` features, `web/src/update/updater.ts`,
`.github/workflows/release.yml`, `RELEASING.md`). **But it will not work until:**

1. **`tauri.conf.json` → `tauri.updater.pubkey` is still the placeholder
   `REPLACE_WITH_CLAVIS_KEY_PUB_CONTENTS`.** A real key must be generated and
   pasted in — see `RELEASING.md` step 1. **`tauri build` will fail to sign
   until this is replaced** (`cargo check`/`dev` are fine — they don't validate it).
2. GitHub secrets `TAURI_PRIVATE_KEY` + `TAURI_KEY_PASSWORD` must be set.
3. A real tagged release (`git tag v1.0.1 && git push origin v1.0.1`) must be
   cut for the whole flow to be testable end-to-end.

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
