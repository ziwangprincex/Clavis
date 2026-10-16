# Clavis — Roadmap

Open work only. Priorities: **P0** = high leverage / low risk, **P1** = planned,
**P2** = strategic or later. Finished work lives in git history and
`docs/releases/`.

**Product constraint: stay lightweight.** Clavis is a focused writing editor,
not a general IDE or application platform. New work must justify its writing
value, binary/runtime cost, and interface cost. Avoid plugin hosts, embedded
terminals, task runners, always-on language services, duplicated toolchains,
and VS Code-style settings sprawl.

---

## P0 — macOS code signing and notarization

**Problem.** `tauri.conf.json` ships with `"signingIdentity": "-"` (ad-hoc) and
the app is not notarized. Every macOS user hits "Clavis is damaged" and must
run `xattr -cr /Applications/Clavis.app` (the Homebrew cask caveat exists only
because of this). A 2026-08-06 incident shows the cost: the app was deleted as
"damaged", which then broke `brew upgrade` (Homebrew moves the old app back to
staging first and hard-fails when it is missing; workaround `brew reinstall
--cask clavis`).

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

---

## P1 — Release notes reach the updater automatically

`release.yml` does not pass `releaseBody` to tauri-action, so `latest.json`
ships with empty notes and is fixed by hand each release. Pass the contents of
`docs/releases/<tag>.md`, and have `check_release.py --tag` require that file
and enforce the 240-character budget.

---

## P1 — CI hardening

- Add `cargo clippy --all-targets -- -D warnings` to CI.
- Add ESLint to the frontend (`web/` has no lint script today).
- Add a macOS verification step to `release.yml` (`codesign --verify --deep
  --strict`; `spctl -a -vv` once notarization exists).

---

## P1 — Intel / universal macOS builds

Only `Clavis_*_aarch64.dmg` is published; the cask hard-codes
`depends_on arch: :arm64`. Build a universal or x86_64 DMG and have
`update-homebrew.yml` write the cask with `on_arch_conditional`.

---

## P1 — Writing correctness gaps

Resolved, verified against the code on 2026-10-16:

- Session restore validates its snapshot structurally (`sessionModel.ts`) and
  then reads every restored file (`checkExternalDocuments(true)`), so a file
  deleted outside Clavis opens into a conflict instead of a dirty buffer.
- Forward SyncTeX from a subfile works: `rel_from` keeps nested relative paths
  (`chapters/intro.tex`), they are written into the workdir with their
  directories, and `syncTexForwardFromEditor` passes that path to
  `synctex view -i`.
- Missing TeX packages install from the problem panel: `extract_missing_pkg`
  names the package and `install_package` runs the manager after a confirm.

Open:

- Typora-style theme ecosystem: done as far as one `user.css`
  (`<config_dir>/clavis/user.css`, edited in Settings → Appearance → Custom
  CSS). Not done: installable/switchable theme folders and a shared gallery.

---

## P1 — Release profile `opt-level`

`Cargo.toml` uses `opt-level = "s"` with `lto = true`. Benchmark compile/preview
latency on a large document against `"2"`/`"3"` and switch if the difference is
visible.

---

## P2 — Tauri v2 migration

Tauri v1 is in maintenance mode. Plan as a dedicated milestone: `src/main.rs`
handler registration, `web/src/api/tauri.ts`, `tauri.conf.json` v2 schema,
updater/dialog/window allowlist → plugins, CSP differences, the PDF window
(`open_pdf_window` and its cross-window events). Freeze v1-only features during
the migration. Afterwards switch to the `@tauri-apps/api` npm
package with `withGlobalTauri: false` and drop `'unsafe-inline'` from
`script-src`.

---

## P3 — Native macOS shell (assessed 2026-10-15, not planned)

A SwiftUI/AppKit rewrite would keep the Rust core (through FFI) but replace the
whole frontend, above all the CodeMirror editor (formatted Markdown, LaTeX
completion, highlighting, tables, formula previews), and drop Windows and
Linux. The native feel is pursued inside the webview first (Texifier-style
toolbar capsules, icons, PDF toolbar). If that falls short, a native shell
(window, sidebar, PDFKit) around the webview editor is the smaller next step.

---

## P2 — Frontend dependency majors

`npm audit` flags pdfjs-dist 5.6 (GHSA-hq66-cqwq-w95j, fixed in 6.2.108) and
the dev-only vite 5 / vitest 2. The pdf.js advisory needs its scripting
sandbox, which Clavis does not load: pages are drawn through the core API
(canvas, text layer, own link layer) and only compiled output is shown.
Upgrade pdfjs-dist on its own with a PDF pass (zoom, selection, find, links,
SyncTeX, dark mode); move vite and vitest to current majors together.

---

## P2 — Surface embedded Typst compiler warnings

Typst returns non-fatal warnings separately from its output; the IPC result
exposes only success output or a fatal error. Add an optional bounded
`warnings: string[]` to the existing result and show it in the current preview
surface. No diagnostics service or new panel.

---

## P2 — Optional system Typst mode (strictly bounded)

Only if demand justifies it: one optional engine choice, Built-in or
System/Custom executable, invoked as one short-lived process with fixed
arguments, cancellation, timeout and a confined root. No version manager,
downloaded toolchain, LSP daemon, or second resident engine.

---

## P2 — Feature backlog

- **Spell checking** for LaTeX/Markdown prose (native `NSSpellChecker` or a
  CodeMirror extension; English first).
- **PDF annotations/highlights**: the PDF view is read-only today.
