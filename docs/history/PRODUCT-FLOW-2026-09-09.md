# Product flow refinement · 2026-09-09

The owner approved a focused product pass: research writing is the main use
case, Markdown stays lightweight, and existing features should be easier to
use rather than multiplied. No slogan, onboarding wizard, plugin system,
new persistent panel, release, or version bump.

## Changes

- Keep the directly editable first-run Markdown scratch buffer. A small,
  dismissible action row offers Open file, New from template, and Open folder.
  It disappears on editing/navigation and never appears over restored work.
  New is always on the toolbar and Cmd/Ctrl+N opens the existing template
  dialog. Blank note needs no folder picker and never overwrites a draft.
- Creating a template opens its main document and project folder, then switches
  LaTeX/Typst to Split or Markdown to Write. Existing buffers remain open.
  The bundled Typst starter still works offline.
- Only selecting the LaTeX starter probes pdflatex (the engine its clavis.toml
  declares). Pending, failed, missing, and found states are distinct. Missing
  TeX does not prevent drafting. Settings and retry are available; returning
  from settings preserves the template/name and repeats detection. This is
  an executable check, not a guarantee that every font/package is installed.
- Document tools now contains file/history/writing/app actions. A separate
  Typesetting disclosure holds format-specific settings; advanced builds are
  folded. PDF export is directly on the toolbar for LaTeX/Typst. LaTeX export
  requires a fresh, matching compiled PDF. Markdown has no irrelevant TeX UI.
  Existing commands remain available; writer tools now also have palette entries.
- Sidebar uses Document, Research, and Project, with empty contextual views
  omitted. Folder and Included files distinguish the filesystem from compile
  dependencies. Writing checks live under Document, collapsed. Build outputs
  appear only when declared; Git appears for a repository or inspection error.
  Both are collapsed under Project. Assets remain available for folder notes.
- Empty/failed PDF views expose compile/retry and relevant recovery actions.
  Actual backend `pdflatex not found in PATH` and custom-executable-path errors
  now lead to environment setup instead of source navigation. No automatic
  software installation or task execution was introduced.
- Uses the existing theme tokens, hit target sizes, scrollable menus, native
  titlebar clearance, and small-window wrapping. Custom font/palette settings,
  session contents, and the earlier local writing/preview fixes are preserved.

## Validation boundary

Tests cover toolbar format filtering/export guards, sidebar availability and
folding, start actions, real App boot/restoration behavior, template creation,
settings return, engine detection failure/retry, and PDF recovery actions.
No browser/Chrome automation or native visual inspection was performed.

Build command: `bash build-macos.sh --app-only --skip-install`.
The existing script preserves Cargo.toml/Cargo.lock around Tauri's local
updater-disabled configuration. The candidate is arm64, retains 1.5.0, is
ad-hoc signed and not notarized. It is not an automatic-update release and
was not installed over the owner's app. No remote operation is authorized.

Native acceptance still required: Air-sized window, both languages/themes,
real multi-file LaTeX, Typst template → preview → PDF, Markdown note, settings
return, keyboard navigation, and long filenames. Tests are not a pixel review.

## Final checks

- TypeScript and all 771 frontend tests passed across 74 files (35 additional
  tests; all previous tests retained). Final rerun log:
  `target/local-builds/product-flow-final-tests.log`.
- Rust: 144 passed, 3 optional ignored. Python guards: 10 passed.
- Production frontend and arm64 App build passed; log:
  `target/local-builds/product-flow-build.log`. Existing Vite mixed-import and
  Rust dependency future-compatibility warnings remain.
- App signature verification passed; Cargo.toml/Cargo.lock restored unchanged.
- Download candidate: `target/local-builds/Clavis-product-flow-2026-09-09-arm64.zip`.
- Final async checks: no startup action flash during pending session recovery;
  late project config/settings trigger refreshed LaTeX preview. New compile
  context tests are separate from the existing auto-compile suite.
