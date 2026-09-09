# Local candidate: writing continuity and release readiness

## Release transition - 2026-09-08

The owner has explicitly authorized publishing **1.2.0**. Versions are updated,
source changes reviewed, and fresh local checks pass: 491 frontend, 119 Rust and
8 Python tests, typecheck, production frontend build and Rust all-target checks.
The formal notes are in [v1.2.0.md](releases/v1.2.0.md). Commit/tag and remote
release operations are authorized for this version; publication still requires
successful CI and complete signed assets. Native interaction and end-to-end
installed-app upgrade checks below remain unperformed, not marked as passed.

The rest of this document preserves the original candidate evidence/checklist.
Its local-only/version-proposal statements describe 2026-09-07, not the current
authorization. See the newest HANDOFF entry for actual publication status.

Date: 2026-09-07. Status: **local candidate; not released**.

Application metadata remains **1.1.1**. The existing `v1.1.1` tag must not be
reused for these changes. **1.2.0 is a proposed next version**, not an approved
or applied bump. All work is local; no commit, tag, push, release, or tap update
has been performed. Do not run remote actions without explicit authorization.

## Candidate release notes

- Calmer writing surface: simplified toolbar and status bar, grouped Workspace
  views, document-specific undo history, quieter page boundaries and typography.
- Sidebar hiding removes all reserved layout space while preserving selected
  view, section expansion and mounted directory tree. Divider is a 1px hairline
  with an overlapping drag hit area instead of a blank strip.
- Sidebar width and editor/preview ratio respond to window size, preserving a
  usable editing area at the supported minimum window width. Widening restores
  the preferred width instead of permanently saving the temporary clamp.
- Hidden Markdown/Typst previews stop automatic rendering. Reopening debounces
  the latest text; old document results never overwrite a new document preview.
- Typst SVG/PDF compilation runs in a blocking worker, not the command/UI thread.
  Live preview allows one running request and replaces intermediate pending
  requests with the newest snapshot. Results of invalidated requests are ignored.
- Typst preview no longer reuses a source-only cache that could hide changed
  includes/images. Reopening reloads external assets even for unchanged source.
- Hidden PDF preview defers document loading/render scheduling; automatic LaTeX
  compilation pauses in editor-only/focus mode. Explicit compile/export stays
  available. An already-running native compile/render is not forcibly stopped.
- Previous same-day fixes cover queued saves, compile snapshots containing open
  buffers and resources, project-aware SyncTeX, per-document PDF ownership, and
  keeping the last PDF visible until its replacement is ready.
- Root build commands, pinned local CLI and CWL preparation make local builds
  reproducible without ad-hoc frontend-hook overrides. Local bundles disable
  updater only for the candidate, and the script restores Cargo input files.
- Tag releases now depend on the same verification workflow as CI before draft
  creation; Homebrew's generated macOS requirement is `>= 11.0`.

## Automated evidence

- Frontend typecheck passes.
- Frontend: **491 tests pass**, including **15 new** layout, queue and actual
  React lifecycle tests. `react-test-renderer` runs without Chrome or a DOM.
- Rust: **119 tests pass**, including **4 new** background Typst tests for
  SVG/PDF, concurrent source isolation, root reset, and recovery after failure.
- Release/working-tree handoff guards: **6 Python tests pass**.
- Production frontend and arm64 macOS app build succeeded via the unified
  local build script. App signature is ad-hoc, not notarized.
- YAML syntax checked locally. GitHub Actions and the remote Homebrew workflow
  have **not** been executed or verified remotely.

## Native acceptance before release

- [ ] Select Research, collapse a section, scroll Workspace, hide/show it and
  enter/leave focus mode. Selection/expansion/scroll should remain; no blank strip.
- [ ] Drag Workspace to its maximum, shrink window to 720px, switch split/editor/
  preview modes, then widen. Writing panes remain usable and preference returns.
- [ ] Type rapidly in a large Typst document, switch documents during compile,
  hide preview, edit, reopen. Observe native responsiveness and newest output.
- [ ] Change an included Typst file or image externally, reopen preview without
  editing the main source, and confirm fresh output.
- [ ] Compile a multi-page LaTeX PDF while scrolled down; hide/show, zoom and
  recompile. Check viewport continuity, no blank flashes and correct ownership.
- [ ] Explicitly compile/export while preview is hidden; ensure output still
  succeeds without forcing continuous background preview work.
- [ ] Switch Documents, undo separately, save rapidly, close/reopen the app and
  confirm dirty/scratch recovery and no cross-document data loss.

These visual/interaction checks are pending human use of the **native app**.
Automated pass counts are not evidence that the GUI feels smooth on real hardware.

## Formal release checklist

- [ ] Accept the native candidate and choose the next version (proposed 1.2.0).
- [ ] Review all local source diffs, tests and docs, not only version files.
- [ ] Update Cargo.toml, Cargo.lock and tauri.conf.json together with
  `python3 tools/set_version.py <approved-version>`; run release metadata checks.
- [ ] Run complete local checks again; document final counts and limitations.
- [ ] Obtain explicit authorization before committing, tagging or pushing.
- [ ] Run tag CI on the exact commit; verify Windows, macOS and Linux installers
  and signed updater assets, then review the single draft release.
- [ ] Check signing keys match the deployed public key; **do not rotate existing
  updater keys** as routine preparation. No private keys were read in this work.
- [ ] Confirm updater end-to-end from a previous published version; local
  updater-disabled app-only candidates cannot validate this path.
- [ ] Publish only after approval and complete assets; verify the subsequent
  Homebrew update and DMG architecture/checksum.

## Known limitations

- Apple notarization and Windows Authenticode remain unimplemented. First-install
  OS security prompts are still expected; updater signatures are a separate issue.
- Cancelling a preview invalidates results and queued work, not already-running
  Typst computation. Native process isolation/hard cancellation is future work.
- Vite reports existing static/dynamic import overlap for Tauri/save modules;
  Rust reports a dependency future-compatibility warning for `block 0.1.6`.
- macOS app-only packaging is verified; this task did not produce/verify a fresh
  DMG or Windows/Linux packages, nor launch a browser or modify remote state.
- Earlier HANDOFF entries are historical and may contain completed follow-ups;
  the new top entry is authoritative for this local candidate.

## Local delivery files

- App ZIP: `target/local-builds/Clavis-1.1.1-macOS-arm64-optimized-20260907.zip`
- Complete modified source files and handoff: `target/local-builds/Clavis-optimization-source-20260907.zip`
- Final build log: `target/local-builds/optimization-build.log`

These are local candidates, not formal release assets.
