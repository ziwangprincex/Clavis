# macOS local builds

Build on macOS with Xcode Command Line Tools, Rust 1.92+, Node.js 20+ and npm.
The host architecture determines the app architecture; this machine produces
Apple Silicon (arm64) builds. MacTeX is needed to use LaTeX, not to build Clavis.

## One command

From the repository root:

```bash
bash build-macos.sh
```

The script installs the locked frontend dependencies, validates release metadata,
runs frontend typechecking/tests, builds frontend assets, runs `cargo test --locked`,
then builds an ad-hoc signed app and DMG. It uses the Tauri CLI already pinned in
`web/package-lock.json`; no global `cargo install` is necessary.

For a local app-only candidate using already-installed dependencies:

```bash
bash build-macos.sh --app-only --skip-install
```

The wrapper also works when invoked by absolute path from another directory.
`--skip-install` assumes the installed dependencies match the lockfile; omit it
on a fresh checkout or after dependencies change. Build/test hooks fetch the
pinned CWL resource only if the matching local resource stamp is absent.

## Build entry points

The root `package.json` forwards build/dev/test/typecheck to `web`. Tauri's hooks
explicitly use the repository root; do not restore temporary empty build-hook
overrides. The actual frontend dependencies remain in `web/package-lock.json`.

```bash
npm --prefix web ci
npm run typecheck
npm test
npm run build
cargo test --locked
bash build-macos.sh --app-only --skip-install
```

The last command is a local app-only build. The standard script disables the
updater **only in the generated local bundle**, leaving production configuration
and public keys unchanged. Tauri may temporarily rewrite Cargo features/lock
data; the script backs up and restores the exact inputs in finally. Do not
edit Cargo inputs concurrently with a build. Local builds need no private keys and do not
publish updates. Formal releases use the tag workflow described in RELEASING.md.

## Outputs

- App: `target/release/bundle/macos/Clavis.app`
- DMG: `target/release/bundle/dmg/Clavis_<version>_<architecture>.dmg`
- Hand-delivered candidate ZIPs: `target/local-builds/`

The application is self-contained; users do not need Node.js or Rust. This build
is **ad-hoc signed, not Apple-notarized**. Internet-downloaded copies may trigger
Gatekeeper. Verify the source before using macOS Privacy & Security to allow a
blocked app; never disable Gatekeeper globally.

## Verification boundary

Automated tests cover logic and React lifecycle behavior without a browser. They
do not certify native input latency, scrolling, PDF paint quality, or visual
appearance. Use the native app and the checklist in docs/history/RELEASE_CANDIDATE.md.
No Chrome preview is part of this project's local verification workflow.

## Troubleshooting

- Frontend failure: run `npm run typecheck` and `npm run build` separately.
- Missing frontend dependencies: run `npm --prefix web ci`.
- Missing command line tools: run `xcode-select --install` yourself.
- npm cache permissions: use a project-local cache such as
  `npm --prefix web ci --cache "$PWD/target/npm-cache"`; do not change system
  permissions merely to build the app.
- DMG bundling failure: retry `--app-only`; a ZIP of the `.app` is sufficient for
  local acceptance testing, but does not replace formal release installers.
- LaTeX engine missing: install MacTeX or configure the engine path in Settings.
  The app discovers `/Library/TeX/texbin`, installed TeX Live year directories,
  `/opt/homebrew/bin`, and `/usr/local/bin`.

macOS app signing/bundling requires a macOS host; Windows/Linux cannot build this
app bundle. Windows and Linux release builds remain a separate CI responsibility.
