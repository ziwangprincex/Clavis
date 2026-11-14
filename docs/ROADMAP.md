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

## P1 — CI hardening

- Add a macOS verification step to `release.yml` (`codesign --verify --deep
  --strict`).

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
  (`chapters/intro.tex`), they are written into the build folder with their
  directories, and `syncTexForwardFromEditor` passes that path to
  `synctex view -i`.
- Missing TeX packages install from the problem panel: `extract_missing_pkg`
  names the package and `install_package` runs the manager after a confirm.

Open:

- Typora-style theme ecosystem: done as far as one `user.css`
  (`<config_dir>/clavis/user.css`, edited in Settings → Appearance → Custom
  CSS). Not done: installable/switchable theme folders and a shared gallery.
- Editor surfaces beyond the writing surface (caret, active line, selection
  fills) do not follow Custom CSS tokens; tokenizing them needs WebKit-safe
  translucency (`color-mix` wants a newer WebView than the deployment target),
  so the settings hint documents the boundary for now.

---

## Measured — release profile `opt-level`

2026-11-14: a 400-section Typst document, release build, `opt-level = "s"` vs
`"3"`: PDF export 13 ms vs 12 ms, preview 67 ms vs 71 ms (warm, incremental).
No visible difference, so `"s"` stays for the smaller binary.
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

## P2 — Optional system Typst mode (strictly bounded)

Only if demand justifies it: one optional engine choice, Built-in or
System/Custom executable, invoked as one short-lived process with fixed
arguments, cancellation, timeout and a confined root. No version manager,
downloaded toolchain, LSP daemon, or second resident engine.

---

## P2 — Feature backlog

- **PDF annotations beyond highlights**: text highlights exist (LaTeX PDF,
  `<main>.highlights.json`, re-anchored by text after each build). Not done:
  notes on a highlight, colours, a list of highlights, highlights in the Typst
  preview, and exporting them into the PDF file itself.
