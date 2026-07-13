# Clavis — Handoff (updated 2026-07-13)

A working-state handoff so the next session (or a future you) can pick up cold.
**Current state is in §0 below — it supersedes the now-historical §2 (git) and
§4 (auto-update) notes, which are kept only as a record of how we got here.**

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
