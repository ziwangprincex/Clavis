# Save protection · local candidate · 2026-09-08

This document describes the earlier first-item delivery. The later complete writer candidate now adds the other roadmap areas, including a separate bounded version timeline and closed-dependency preview refresh; see `WRITER_FEATURES.md` for current status. Save protection behavior and filesystem limits below still apply. Version and release metadata remain unchanged.

## Behavior

- Opened documents carry a SHA-256 baseline of the exact UTF-8 disk contents. This baseline persists with the session; metadata probe stamps and transient errors/conflict payloads do not.
- Every manual save, Save As and autosave uses the same frontend queue and a version-checked Rust command. New typing during a write stays dirty; queued saves use the newest buffer and disk baseline.
- While the app is visible, opened paths are probed every four seconds using metadata. Contents are read only when metadata changes, a baseline is unknown, or verification is retried. Returning to the foreground forces a content verification.
- A clean, known-baseline document reloads external changes without switching tabs or forcing editor scroll. Dirty documents, externally deleted files and legacy recovery buffers without a baseline are preserved for review.
- A small notice appears only for affected files. It does not open a modal or move keyboard focus by itself. Autosave pauses for that document, not the whole workspace.
- **Review** shows full disk text alongside editable local text, with an optional highlighted diff. The highlight is limited to the first 12,000 characters; the two text editors are complete. This is manual two-way merging, not an automatic three-way merge engine.
- **Keep local · replace disk** and **Save merged version** submit the reviewed disk revision, not a blind force flag. Another external change requires another review. **Use disk version** also rereads and verifies before replacing the buffer. **Save local as…** writes the live local buffer to a chosen path; an existing differing destination requires review.
- Replacing a local buffer preserves a scratch local copy. Explicitly replacing disk contents preserves the reviewed disk text as a scratch copy. Closing a hand-edited comparison preserves a scratch merge draft. These copies do not change the focused tab and are covered by existing debounced session recovery. They are not durable version history; saving important copies to disk remains appropriate.
- Workspace replace/reference rename reload notifications now use the same guarded reconciliation, avoiding a late read overwriting text typed while it was in flight.

## File safety and limits

Rust checks the expected content revision, writes and syncs a temporary sibling file, checks again immediately before replacement, and then renames. New-file saves use no-clobber persistence. Temporary files clean up on ordinary errors. Invalid UTF-8, non-file paths and oversized documents fail closed without truncating disk contents.

The safe-edit size limit is **32 MiB** per document. This path edits UTF-8 documents and preserves their exact text bytes, including line endings, until the editor changes them. Symlinks resolve to their actual target; dangling symlinks and hard-linked files require Save As. Basic filesystem permissions are retained. Atomic replacement is not guaranteed to preserve every extended attribute, custom ACL or file-provider behavior.

External programs do not share Clavis's lock. No portable filesystem primitive offers conditional replacement of an existing file based on its hash, so there remains a narrow race between final verification and rename. This implementation substantially protects normal editor/sync-tool conflicts but is not a cross-process transaction or a power-loss guarantee. Recovery/session copies are also not a backup product.

The protocol covers editor document saves. PDF exports and project report output retain their existing dedicated export paths. An external edit in an unopened dependency is not automatically refreshed by this opened-document monitor; the later project dependency/performance work remains pending.

## Verification

- TypeScript checks pass.
- 544 frontend tests pass, including 33 save/reconciliation/conflict-UI tests.
- 133 Rust tests pass; one optional real-tool test is ignored. Seven new disk tests cover same-length external edits, deletion/creation conflicts, reviewed-version rechecking, invalid UTF-8/non-files, symlinks/permissions/hardlinks, dangling links and Unicode/line-ending round trips.
- Frontend production build passes.
- Local macOS packaging completed. `codesign --verify --deep --strict` passes, and Cargo.toml/Cargo.lock match their pre-bundle backups byte-for-byte. The app is ad-hoc signed, not Apple-notarized.
- App: `target/release/bundle/macos/Clavis.app`. Download: `target/writer-safety/Clavis-save-protection-macos.zip`.
- No Chrome/browser preview. Native visual/focus behavior has not been manually accepted.

## Build environment

The previous global Cargo registry source/cache was missing and its cache location was not writable. Locked dependencies were restored into `target/writer-safety/cargo-home`, without changing system permissions or Cargo configuration. To reproduce locally:

```sh
CARGO_HOME=/Users/prince/Clavis/target/writer-safety/cargo-home CARGO_NET_OFFLINE=true node /Users/prince/Clavis/tools/build-macos.mjs --app-only --skip-install
```

The build script backs up and restores Cargo.toml/Cargo.lock around Tauri's updater-disabled packaging. Do not edit Cargo inputs in parallel with packaging. No developer credentials, remote commit/push or release operation is part of this task.
