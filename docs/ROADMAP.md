# Clavis — Future Improvements Roadmap

Status: **proposed, not yet implemented** (recorded 2026-08-06 from a project
review). Priorities: **P0** = high leverage / low risk, **P1** = planned,
**P2** = strategic or later. Each item lists the problem, the suggested change,
and the relevant code locations. Nothing here is committed work; treat it as a
backlog, not a plan of record.

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

## P0 — Documentation drift fixes (README)

**Problem.** `README.md` **Git inspection and prose diff** still claims the Git
sidebar "does not stage, commit, restore, reset, or push anything", but
`src/main.rs` now registers `git_stage_file`, `git_unstage_file`, and
`git_create_commit` (added 2026-08-06, "bounded local Git stage and commit").
The README is behind the code and misleads users about the trust boundary.

**Change.**

- Rewrite the Git section to describe the bounded stage/unstage/commit surface
  (what is allowed, what remains read-only).
- Fix the `**Settings ? Editor**` text (the `?` is a broken arrow character).

**Payoff.** Accurate docs, especially important for a security-model-sensitive
project.

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

## P2 — Typst engine upgrade

**Problem.** `Cargo.toml` pins `typst` / `typst-svg` / `typst-pdf` /
`typst-assets` at 0.11. Typst the language moves fast (0.12/0.13+ have breaking
changes); users with newer documents will get compile errors the built-in
engine cannot handle.

**Change.** Upgrade typst crates and run the regression suites in
`src/typst_world.rs`, `src/typst_sig.rs`, and the frontend Typst preview.

**Payoff.** Correct rendering for current Typst syntax.

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
