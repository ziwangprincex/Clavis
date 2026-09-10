# Clavis 1.7.1 release verification

Published 2026-09-10 at 03:51:56 UTC under the owner's explicit instruction to
push and release version 1.7.1. This authorization is scoped to this release,
its updater metadata and the associated Homebrew update.

## Source and workflows

- Release commit/tag: `a1a2ffe` / `v1.7.1`; all three version fields match.
- Complete bibliography/guidance source, regression tests, shared diagnostic
  fixtures and HANDOFF were committed together. No trial builds were committed.
- Main CI: https://github.com/ziwangprincex/Clavis/actions/runs/34433370079
- Exact-tag CI and three-platform release:
  https://github.com/ziwangprincex/Clavis/actions/runs/34433372652
- Homebrew: https://github.com/ziwangprincex/Clavis/actions/runs/34434956903
- All three workflows succeeded before release closeout.
- Fresh local checks: TypeScript, 858 frontend tests, frontend production build,
  Rust all-target check, 152 Rust tests (3 optional ignored), 10 Python guard tests,
  version/tag validation and HANDOFF guard.

## Published assets

- Release: https://github.com/ziwangprincex/Clavis/releases/tag/v1.7.1
- All 11 downloaded asset sizes and SHA-256 digests match GitHub metadata.
- All 3 updater package signatures verify against the unchanged production
  public key, including trusted comments and rejection of tampered input.
- Six platform entries match the previous manifest's supported targets.
- Public latest.json reports 1.7.1 with the same compact three-bullet notes as
  `docs/releases/v1.7.1.md` and the GitHub release body.
- The generated draft manifest initially had empty notes. Before publication,
  only `notes` was replaced with the approved short release text; package bytes,
  signatures, URLs and all other manifest fields were preserved and rechecked.
- Tauri uses `/releases/latest/download/` package aliases. After publication,
  unauthenticated downloads of all three updater URLs and the macOS DMG match
  the already-verified asset hashes. The packaged macOS Info.plist says 1.7.1.
- Homebrew cask version is 1.7.1 and its SHA-256 matches the published DMG.

Local evidence is under `target/release-verification/v1.7.1/` (ignored): build
logs, release metadata, before/after/public manifests, asset signature verification,
public download hashes and Homebrew checksum results. No signing secrets stored.

## Boundaries

No existing tag was moved. No Apple credentials, notarization, MCP, browser
preview or installed-application replacement was performed. The updater remains
active in this formal release, unlike the prior local trial ZIP.

Native GUI/readability on the user's thesis and a real in-app upgrade on their
MacBook Air have not been manually accepted; automated and cryptographic checks
do not claim that acceptance. A user on the updater-disabled trial must manually
install the formal DMG once before using in-app updates again.
