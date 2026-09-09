# Font control, interface language and interaction repairs

Local candidate, 2026-09-09. No version bump, push or release authorization.

## Visual correction after feedback

PDF surroundings are not user-colorable. The old pdf_bg_color option is removed and its saved value is discarded during migration; the renderer ignores it even before migration. Paper stays white by default, with fixed neutral surroundings for light/dark modes, never an accent-colored border. Existing explicit invert/sepia page filters are unchanged. No personal settings file was edited.

Accent and editor color controls share a flat labelled swatch, hex readout and lightweight Follow theme action. Swatches display the effective theme color, not a black placeholder. Native input styling is normalized while keyboard focus remains visible. This adds no new options. Follow-up evidence: 714 frontend tests, typecheck and local build log at target/ui-refinement/pdf-color-build.log; native visual acceptance remains pending.

## Preferences

Settings → Appearance → Interface language offers Follow system, 简体中文 and English. Save applies the selection; Cancel discards it. Chinese system locales select Simplified Chinese in automatic mode. This is independent of the document language (Markdown / LaTeX / Typst). Chrome, settings, common dialogs, command palette, editor search controls and update prompts have Chinese strings. Command search accepts both the translated name and its original English label. Compiler output, document contents, file paths, package names and OS-owned menu labels are not translated.

Settings → Appearance controls the UI family, UI size and UI code family. The code family defaults to the editor family. Display headings no longer force a separate system/serif face. CSS chrome typography scales with the UI base; source and Markdown document sizes stay independent.

Settings → Editor controls source family, size and line height. Settings → Preview controls Markdown body family, size, line height, reading width and surface. Typography overrides exposes H1–H6 family/relative size/weight, quote family, inline-code family and code-block family. Headings and quotes default to body inheritance; code defaults to the editor. An empty override restores inheritance. A rendered six-heading/quote/code sample shows the current draft.

Family fields offer a native list of installed families, allow explicit fallback order and show bilingual sample text. Missing named families are identified. The native scan uses existing fontdb on a background worker, not Typst's embedded-font list. Actual glyph fallback and available weights depend on each machine's installed fonts. The app does not download fonts. PDF/Typst output and mathematical typesetting retain their source-controlled/specialist fonts.

## Repaired behavior

- Shared accent now reaches the resolved editor theme, chrome, cursor and selection. Explicit selection overrides still win. White-paper Markdown adapts the same accent only if contrast against white needs improvement. Theme samples include user UI font/color overrides; saving, rather than editing the draft, changes the whole window.
- Settings save failures leave the draft/dialog open with an error and retry. Only edited fields are saved, so unrelated background changes such as recent files are preserved. Writes are queued; native settings replacement uses a same-directory temporary file. Quick preference-save failures appear in the status bar.
- Reset applies only to the active category. Appearance cannot erase engine paths, recents or geometry. Custom executable paths remain untouched by category reset.
- Shared modal handling restores focus, wraps Tab/Shift+Tab and prevents document shortcuts from firing inside dialogs. Escape closes eligible dialogs; mutations block dismissal while busy. The existing document-merge safety logic is preserved.
- Markdown outline entries are keyboard-accessible. Read-mode directory navigation targets rendered headings, Typst source mapping or PDF SyncTeX instead of a hidden editor. Write and Split retain source navigation.
- Markdown formula parsing uses Marked token extensions, preserving inline/fenced/indented code and URL attributes. Both dollar and double-dollar formula syntax remain supported. Raw source HTML and active URL schemes remain disabled.
- Top-level ATX/setext headings share source lines and Unicode/duplicate-safe anchors with the outline. Nested quote/list headings do not consume top-level anchors. Fragment clicks stay within the preview.
- Relative Markdown images resolve from the saved document location using the existing native asset-preview API. Canonical paths must stay inside the document folder or open workspace; its existing 2 MiB limit remains. Failed, unsupported or unsaved-path images get an explicit message. Reads are sequential, deduplicated within each pass and ignore results after document changes.
- The command-palette icon is now a neutral command-list symbol on all three platforms, not the macOS Command-key symbol. Actual shortcut labels remain platform-specific.

## Implementation

- `web/src/store/settings.ts`, `src/settings.rs`: preference schema, migration, write queue and persistence.
- `web/src/components/SettingsDialog.tsx`, `FontField.tsx`, `web/src/theme/typography.ts`, `src/system_fonts.rs`: controls, inheritance and installed families.
- `web/src/i18n/`: English-keyed Simplified Chinese dictionary, language resolution and status envelopes.
- `web/src/theme/appTheme.ts`, `web/src/hooks/useAppTheme.ts`, component styles: shared accent and scalable chrome type.
- `web/src/hooks/useModal.ts`, `web/src/App.tsx`: modal keys and layout-aware navigation.
- `web/src/render/markdown.ts`, `markdownView.ts`, `web/src/store/outline.ts`: syntax-safe formulas, anchors and local images.

No runtime dependency, updater key, production updater setting, release metadata or CI policy changed. The five pre-existing untracked one-off tools remain untouched. Work scripts and logs live only under ignored `target/ui-refinement/`.

## Verification

706 frontend tests and 144 Rust tests pass (three pre-existing optional Rust tests ignored). TypeScript and Rust all-target checks, ten Python guard tests, release metadata and whitespace checks pass. Added regressions cover settings failure/retry/reset/concurrent updates, Chinese persistence, modal focus/keys, six-level font inheritance, unified accent, Markdown protected syntax and anchors, image lifetime/path bounds, bilingual command search and neutral icon.

Evidence: `target/ui-refinement/frontend-tests.log`, `rust-tests.log`, `rust-check.log`, `build.log`. Local macOS candidate packaging is tracked in HANDOFF. No Chrome preview, installed-app replacement or remote operation. Native MacBook Air visual/keyboard acceptance and Windows/Linux builds are not claimed verified by these tests.

Manual acceptance should check UI size 10/13/20 at a small window, saved/reopened Chinese and English, font changes in Write/Split/Read, fallback warnings, six headings and both code types, Read outline/anchors, local image failures and keyboard-only modal interaction. Confirm the footer remains reachable while reading long font lists or setting errors.
