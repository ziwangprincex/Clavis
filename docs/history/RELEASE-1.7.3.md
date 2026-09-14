# Clavis 1.7.3 release verification

Published 2026-09-14 at 07:24:13 UTC under the owner's explicit instruction to
update HANDOFF, push and release. Scope: version 1.7.3, its updater metadata and
associated Homebrew update. No older release was modified.

## Source and workflows

- Release commit/tag: `1d3f483` / `v1.7.3`; all three version fields match.
- Complete Problems-sidebar source, regressions, settings migration and HANDOFF
  committed together. Local trial artifacts were not committed.
- [Main CI](https://github.com/ziwangprincex/Clavis/actions/runs/34815987520): succeeded.
- [Exact-tag CI and three-platform release](https://github.com/ziwangprincex/Clavis/actions/runs/34815991783): succeeded.
- [Homebrew update](https://github.com/ziwangprincex/Clavis/actions/runs/34817695982): succeeded.
- Fresh local checks passed: TypeScript, 890 frontend tests, production build,
  Rust all-target check, 152 Rust tests (3 optional ignored), 10 Python tests,
  version/tag validation, HANDOFF guard and whitespace check.
- Non-blocking toolchain warnings: Rust dependency `block` future compatibility
  and GitHub Actions Node 20 deprecation. No CI gate was disabled or bypassed.

## Assets and updater

- [Published release](https://github.com/ziwangprincex/Clavis/releases/tag/v1.7.3).
- All 11 downloaded assets match GitHub sizes and SHA-256 metadata.
- Three updater package signatures verify with the unchanged production public
  key, including trusted comments and rejection of tampered inputs.
- Six platform entries match the previously supported targets.
- The generated draft manifest had empty notes. Before publication, only its
  notes were replaced by the approved three-bullet release text (108 characters).
  Versions, URLs, signatures and other manifest values remained unchanged.
- The public latest manifest matches the verified draft manifest, including notes.
  Anonymous downloads of all three updater URLs and the macOS DMG match verified
  hashes. The macOS app Info.plist reports 1.7.3.
- Homebrew tap commit `dc93d38` contains version 1.7.3 with the matching DMG
  checksum and `depends_on macos: :big_sur`, retaining the Homebrew 6 fix.
- Local evidence, downloads, scripts and logs remain ignored under
  `target/release-verification/v1.7.3/`; no signing secrets were accessed or stored.

## Boundaries

The draft was published only after all builds and artifact checks passed. No tag
was moved; no Apple credentials, notarization, MCP, browser preview or installed
application replacement was used. Formal auto-update stays enabled. This is not
a claim that the owner's native GUI or actual in-app upgrade was manually tested.
A user on an updater-disabled local trial must install the formal app once to
restore the in-app update path.
