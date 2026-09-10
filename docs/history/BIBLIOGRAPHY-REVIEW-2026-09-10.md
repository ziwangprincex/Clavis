# Bibliography guidance and hover review · 2026-09-10

Local follow-up to the five review findings in the uncommitted post-v1.7.0 work.
No commit, push, release, installation, Apple credentials or notarization.

## Changes

- Hover classification uses the command name, not `cite` anywhere in the label.
- Removed the duplicate TypeScript BibTeX parser. The existing `parse_bib` command
  accepts optional in-memory bibliography documents and runs the same Rust parser
  used by the bibliography browser. Disk-only callers remain supported.
- Snapshot lookup caches only the current bibliography set, includes unsaved
  buffers, retries failed requests, and rejects results after document, project,
  active path or bibliography changes. Paths use the existing normalization.
- Parenthesized records, quoted values with grouped quotes/TeX accents and escaped
  braces are supported. Unknown TeX commands remain literal rather than being
  partially erased; existing `\&`, `\_`, `\%` plain-text decoding remains.
- Authors and organizations are displayed in full, with editor/date fallbacks.
  Missing-key wording refers only to loaded .bib files. Parser failures are not
  described as missing entries.
- Guidance distinguishes missing tools, missing databases/styles, bibliography
  processor failures, duplicate labels and requests for additional passes.
  Source buttons are hidden when no line was reported. Duplicate labels instruct
  users to remove/rename duplicates rather than rerun the compiler.

## Verification

- 858 frontend tests pass, including actual hover callbacks, LogPanel actions,
  cache invalidation, failed requests, stale results and Windows path cases.
- 152 Rust tests pass; 3 pre-existing optional tests ignored. Shared diagnostic
  fixtures test both Rust log conversion and frontend routing, not only raw logs.
- TypeScript, frontend production build, 10 Python guard tests pass.
- Existing local macOS build script completes. Ad-hoc signature verifies;
  Cargo.toml, Cargo.lock and tauri.conf.json match pre-build SHA-256 checksums.
- Evidence: `target/local-builds/bibliography-review-20260910/build.log` and
  `inputs.sha256`. App: `target/release/bundle/macos/Clavis.app`.

## Follow-up review and limits

Rechecked the new implementation, not just the original findings. Fixed a failed
request/empty-library cache edge and preserved existing plain-text escape decoding.
No remaining blocker was identified within these five fixes.

This is still a metadata parser, not full BibTeX macro evaluation. TeX accents may
be shown literally rather than typeset. Hover only searches loaded bibliography
snapshots and still selects the first key of a multi-key citation, as before.
Native GUI/readability acceptance on the user's thesis and MacBook Air is pending.
The local candidate disables the updater; it is not a signed public update release.
