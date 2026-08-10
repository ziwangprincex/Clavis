# Clavis — Future Improvements Roadmap

Status: living backlog, last updated 2026-08-10. Priorities: **P0** = high
leverage / low risk, **P1** = planned, **P2** = strategic or later. Completed
items stay recorded with their verification evidence so they do not silently
return as stale backlog.

**Product constraint: stay lightweight.** Clavis is a focused native research
writing editor, not a general IDE or application platform. New work must justify
its writing value, binary/runtime cost, and interface cost. Avoid plugin hosts,
embedded terminals, always-on language services, duplicated toolchains, and
VS Code-style settings sprawl.

---

## P0 — macOS code signing and notarization

**Problem.** `tauri.conf.json` ships with `"signingIdentity": "-"` (ad-hoc) and
the app is not notarized. Every macOS user hits "Clavis is damaged" and must
run `xattr -cr /Applications/Clavis.app` (the Homebrew cask caveat exists only
because of this). A 2026-08-06 user incident shows the real-world cost: the app
was deleted as "damaged", which then broke `brew upgrade` (old app missing at
`/Applications/Clavis.app`). This is the top source of install friction and
support burden.

**Change.** Register for an Apple Developer ID ($99/yr) and:

- Add signing + notarization to the macOS job in
  `.github/workflows/release.yml` (tauri-action supports
  `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` for signing and
  `APPLE_API_KEY` / `APPLE_API_ISSUER` for notarization via
  `xcrun notarytool`).
- Set `bundle.macOS.signingIdentity` to the Developer ID Application identity
  (keep `null` for local dev builds).
- Verify artifacts in CI: `codesign --verify --deep --strict` and
  `spctl -a -vv` after notarization.

**Payoff.** Removes the "damaged" caveat from the cask, raises install success
rate, and removes a whole class of "missing app" upgrade failures.

---

## Completed 2026-08-10: Documentation drift fixes and README language parity

`README.md`'s **Git inspection and prose diff** section claimed the sidebar
"does not stage, commit, restore, reset, or push anything". That had been false
since 2026-08-06, when `git_stage_file`, `git_unstage_file`, and
`git_create_commit` were registered (`src/main.rs:365-367`) — a stale
security-boundary claim, the worst kind to leave in a README. Both language
versions now describe the bounded write surface (stage/unstage an
already-listed changed file, confirmed local commit, 200-character single-line
message, `--no-gpg-sign`, empty `core.hooksPath`, clean-filter files refused)
and restate what remains impossible: push, fetch, pull, checkout, reset,
restore, rebase, merge, branch switching, or any remote contact.

The broken `**Settings ? Editor**` arrow glyph is fixed to `**Settings →
Editor**`.

The same pass closed a wider drift: `README.zh-CN.md` documented 10 sections
against the English file's 24, so everything added since the Workspace Trust
foundation was English-only. The Chinese README is now structurally identical
(same 24 headings, same order), with 14 sections newly translated. Convention
for future edits: Chinese headings, but UI strings stay English (`Settings →
Editor`, `Run Project Doctor`, sidebar names) because the interface itself is
English — translating them would leave readers unable to find the control.

**Verification.** Documentation only; no source, configuration, or test was
touched, so no build or test claim applies. Heading parity was verified by
diffing the two files' `^#` heading lists one-to-one. The Git prose was checked
against `src/main.rs:365-367` and the 2026-08-06 "bounded local Git stage and
commit" handoff entry, not against a running UI. The other 13 translated
sections were taken as accurate from the English text rather than re-verified
against the code, so unrelated stale claims could still survive in either
language.

---

## P1 — CI hardening

**Problem.** CI (`.github/workflows/ci.yml`) runs typecheck, Vitest, `cargo
check`, and `cargo test`, but has no lint gate and no artifact verification.

**Change.**

- Add `cargo clippy --all-targets -- -D warnings` to CI.
- Add ESLint to the frontend (`web/` has no lint script today).
- In `.github/workflows/release.yml`, add a macOS verification step
  (`codesign --verify --deep --strict`; `spctl -a -vv` once notarization
  exists) so a silently broken signing configuration cannot ship.

**Payoff.** Catches regressions and signing drift before release instead of in
the field.

---

## P1 — Distribution coverage: Intel / universal macOS builds

**Problem.** Only `Clavis_*_aarch64.dmg` is published; the Homebrew cask hard-
codes `depends_on arch: :arm64`. Intel Macs (and any future non-ARM Mac) cannot
install, and the cask cannot express both architectures.

**Change.**

- Build a universal (lipo) or x86_64 DMG alongside the aarch64 one.
- Update `tools/`/`.github/workflows/update-homebrew.yml` to compute a per-arch
  `sha256`, and write the cask with `on_arch_conditional` for the two DMG URLs.

**Payoff.** Larger install base; the tap pipeline stays automatic.

---

## P1 — Performance: release profile `opt-level`

**Problem.** `Cargo.toml` uses `opt-level = "s"` (size-optimized) with `lto =
true`. For a live-preview editor, Typst/PDF rendering and workspace scans are
latency-sensitive; size optimization can cost meaningful runtime performance.

**Change.** Benchmark compile/preview latency on a large representative
document with `opt-level = "s"` vs `"3"` (or `"2"`). If the difference is
visible, switch to the faster setting; the binary size increase is a one-time
download cost.

**Payoff.** Snappier previews, or a documented justification for the current
choice.

---

## P2 — Tauri v2 migration

**Problem.** Tauri v1 is in maintenance mode. Clavis has 60+ IPC commands, a
custom updater, and a multi-platform matrix all built on v1; the cost of
migrating grows with every feature added. v2 offers better macOS
signing/notarization support, universal binaries, and a maintained plugin
ecosystem.

**Change.** Plan as a dedicated milestone, not ad-hoc:
`src/main.rs` handler registration, `web/src/api/tauri.ts` IPC wrapper,
`tauri.conf.json` v2 schema, updater/dialog/window allowlist → plugins,
CSP differences. Freeze new v1-only features during the migration.

**Payoff.** Long-term maintenance and the easiest path to improved macOS
distribution.

---

## Completed 2026-08-07: Typst 0.15.1 engine upgrade

The built-in engine moved from Typst 0.11.1 to 0.15.1. The migration updated the
`World` implementation, project-root path model, compiler output API, SVG/PDF
exporters, diagnostic spans, syntax-tree access, and standard-library signature
metadata. The Rust MSRV is now 1.92.

The upgrade remains self-contained: users still need no local Typst install and
Clavis does not bundle a second CLI or background service. `fontdb` was aligned
with Typst's 0.23 dependency to avoid carrying duplicate font databases.

**Verification.** 110 Rust tests include real SVG/PDF output, line/column
diagnostics, in-root includes, and project-root escape rejection. The frontend
has 455 passing tests; typecheck, production build, and `cargo check
--all-targets` pass. A size-optimized Windows release executable is 39.4 MB.

---


## P2: Surface embedded Typst compiler warnings

**Problem.** Typst compilation returns non-fatal warnings separately from its
SVG/PDF output, but the current compact IPC result exposes only success output or
a fatal error. Warnings were already silent before the 0.15 migration.

**Possible change.** Add an optional bounded `warnings: string[]` field to the
existing Typst result and show it in the current preview/error surface. Do not
add a diagnostics service, background process, or Problems-panel subsystem.

**Acceptance bar.** Preserve the existing single-call preview path and verify
that warning formatting, payload size, and render latency remain negligible.

---

## P2: Optional system Typst mode (strictly bounded)

**Problem.** The built-in engine gives deterministic, zero-setup behavior, but a
user with a newer local Typst may want new language features before Clavis ships
another embedded-engine update.

**Possible change.** Only if demand justifies it, add one optional engine choice:
Built-in or System/Custom executable. Reuse bounded tool detection; invoke one
short-lived `typst` process with fixed arguments, cancellation, timeout, and a
confined working root. Fall back to the built-in engine when unavailable.

**Non-goals.** No Typst version manager, downloaded toolchain, LSP daemon,
terminal, extension host, project graph, or large engine-settings surface. Do
not keep both engines resident and do not bundle the Typst CLI alongside the
Rust engine.

**Acceptance bar.** Demonstrate a real compatibility need, preserve the default
zero-install path, and measure installer size, idle memory, startup, and preview
latency before shipping.

---

## P2 — CSP tightening after legacy UI migration

**Problem.** `tauri.conf.json` ships `script-src 'self' 'unsafe-inline' blob:`
with `withGlobalTauri: true`; `web/src/api/tauri.ts` documents that this is a
deliberate bridge for the legacy `ui/` surface during migration.

**Change.** Once the legacy UI is gone, switch to the `@tauri-apps/api` npm
package with `withGlobalTauri: false` and remove `'unsafe-inline'` from
`script-src`.

**Payoff.** Defense in depth for the webview (the boundary the security model
already treats as untrusted-ish input).

---

## P2 — Feature backlog (researcher-facing)

Proposed, unordered:

- **Spell checking** for LaTeX/Markdown prose (native macOS `NSSpellChecker`
  or a CodeMirror extension; English first). Highest-value missing writing aid.
- **latexmk integration**: a "compile with latexmk" mode (`latexmk -xelatex`)
  to fix cross-reference/BibTeX pass ordering; the task system can already do
  this, but a built-in toggle is better UX.
- **PDF annotations/highlights**: the PDF view is currently read-only
  preview + search; annotation is a common research workflow.
- **Template gallery**: paper/slides/resume starters, building on the existing
  manuscript figure insertion templates.
- **Word-count performance**: status-bar estimates exist; keep them cheap on
  large documents.

---

## P2 — Repo hygiene

- `docs/HANDOFF.md` is ~158 KB and growing; archive per-release entries into
  `docs/handoffs/` when they age out, keeping `docs/HANDOFF.md` as a rolling log.
- Generate release notes (currently a one-line body) from HANDOFF/commits in
  `.github/workflows/release.yml`.

---

## Notes

- **Homebrew cask deprecation (already fixed locally, needs push).** The tap
  cask used `depends_on macos: ">= :big_sur"`, deprecated by Homebrew 6.x.
  `ziwangprincex/homebrew-clavis` was fixed locally on 2026-08-06 to
  `depends_on macos: :big_sur` (equivalent semantics); push the tap repo to
  publish.
- **2026-08-06 upgrade failure incident (context for P0).** `brew upgrade`
  failed with "It seems the App source '/Applications/Clavis.app' is not there"
  because the user had deleted the ad-hoc-signed (unopenable) app while
  Homebrew still recorded 1.0.1 as installed. Upgrades move the old app back
  to staging first (`cask/artifact/moved.rb` `move_back`), and hard-fail when
  it is missing. Workaround: `brew uninstall --cask clavis` then reinstall, or
  `brew reinstall --cask`. Notarization removes the root cause.
