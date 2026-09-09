# Marker-inspired writing surfaces

Local design candidate, 2026-09-08. The owner asked Clavis to learn from Marker and try the design in the application. This is a local iteration, not a new release or permission to push these changes.

## Design

- Paper uses warm ivory, botanical green and restrained plum/brown syntax. Ink pairs olive charcoal with sage. Mist, Dusk, classic theme IDs and explicit user overrides remain available.
- Installed literary serif faces distinguish the Workspace heading, Markdown titles and quotations from UI text. No Marker brand asset or third-party font is copied or downloaded. Source text remains in the selected editor font, including LaTeX and Typst.
- Editing measure is 78ch for source, 68ch for Markdown, with centred gutter/text and smaller insets below a 560px pane width. CodeMirror keeps ownership of content measurement, wrapping, selections and scroll state. No re-mount, max-width or transform is applied to its content layer.
- Markdown reading measure is 34/42/50em for narrow/medium/wide. Inset space is counted separately. The font-size-relative measure follows custom reading sizes; narrow split panes get reduced padding. Headings, paragraphs, lists, tables and quotes share a calmer vertical rhythm. Links have persistent underlines; code, tables and display formulas can scroll horizontally. Author-specified table alignment is preserved.
- The sidebar uses a literary heading and underlined text navigation instead of another segmented box. File labels use UI type. Tabs use a fine active rule; the layout control stays quiet; Compile is the single filled accent action. Tooltips/completions use the same palette and softer corners, without changing labels, insertion or keyboard handling.
- Fresh/default settings use a 16px source font and 17px reading font. Existing saved font families, sizes, line heights, layouts and themes are not migrated or overwritten. Existing users can set these sizes in Settings if desired. No user settings file is edited by this change.

## Implementation

Existing theme tokens, CSS Modules and CodeMirror theme rules only. No new runtime dependency, UI framework, wrapper state or compatibility layer. Container queries are a progressive layout improvement; base padding remains usable when unavailable. No PDF/Typst document geometry, zoom scheduler or compilation behavior changes.

Entry points: `web/src/theme/themes.ts`, `chromeTokens.ts`, `web/src/styles/tokens.css`, editor/sidebar/tab/toolbar/reading CSS modules and `web/src/editor/controller.ts`. `web/src/theme/writingDesign.test.ts` checks stylesheet scope, measure contracts, author table alignment, selected completion targeting and stored setting preservation. Native source-font defaults in `src/settings.rs` remain aligned with frontend defaults.

## Validation

- 645 frontend tests, TypeScript checking and production frontend build pass.
- After the separate CI cancellation fix, 142 Rust tests pass, with three optional tool/benchmark tests ignored. Ten Python guard tests pass. See `docs/history/CI_RUNNER_FIX.md` for the GitHub runner investigation; the UI changes were not in the failed GitHub runs.
- Continued build completed successfully: `target/marker-study/Clavis-Marker-CI-Fix-macOS-arm64.zip` contains the current design plus process cancellation fix. App signature, ZIP integrity and exact Cargo input restoration all pass. It is an ad-hoc signed local candidate, not installed, Apple-notarized or released.
- All four signature palettes retain >=7:1 body contrast, >=4.5:1 secondary/accent/severity text, >=4.5:1 syntax on both normal and active lines, and >=3:1 gutter text.
- Static stylesheet tests and compiled CSS are checked, but are not screenshots or layout measurements. Native appearance, text selection at extreme sizes and actual interaction feel remain manual acceptance items. No Chrome, browser automation or remote repository service is used.
- Local macOS packaging is performed with `bash build-macos.sh --app-only --skip-install` and the existing workspace Cargo cache. The script temporarily disables updater bundling and restores Cargo inputs afterward; final checksum/signature status is recorded in HANDOFF. Version and production update key are unchanged.

## Try it

Open the locally built candidate after saving current work; choose Clavis Paper or Clavis Ink under Settings / Appearance. For the intended first-run scale, choose editor 16px and preview 17px if older saved values are still active. Try a Markdown document in Write, Split and Read, then a LaTeX document with completion suggestions and a PDF preview. Resize each pane and check that narrow widths remain useful. No existing installation is replaced automatically.

Reference studied: public HTML/CSS from https://my.marker.page/ and https://marker.page/. The signed-in Marker workspace and its interaction performance were not observed. Local research/build logs are under ignored `target/marker-study/`.
