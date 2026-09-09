# Clavis theme refresh · 2026-09-08

Local development candidate, not a new release. The existing LaTeX/Typst workflow changes are retained. No remote lookup, commit, push, publishing, Chrome preview or Apple developer credential operation is part of this pass.

## Appearance

Open **Document tools → Settings → Appearance**. Choose a sample, then **Save**. Cancel discards the draft. The original theme selector remains available, including all classic palettes and automatic system appearance.

| Theme | Surface | Accent |
| --- | --- | --- |
| Paper | Warm off-white `#faf9f6` | Slate blue `#536b86` |
| Ink | Soft graphite `#20242b` | Cool silver-blue `#a7bcd4` |
| Mist | Cool porcelain `#f4f7f8` | Muted teal `#496c79` |
| Dusk | Warm charcoal `#29262d` | Dusty violet `#c3adc9` |

Paper and Ink retain their existing IDs, so users already choosing them receive the revised colors. Automatic appearance follows the OS light/dark preference, not a time schedule. Explicit classic theme choices are not silently replaced.

Custom editor/UI colors remain intact. **Use original palette** clears only color overrides in the draft, not fonts, engines, layout, or other preferences. Samples show built-in surface composition and the selected editor/accent draft; arbitrary advanced UI token overrides may further change the saved appearance.

## Visual changes

- Harmonized background, recessed workspace, elevated popovers, muted text and accent tints.
- Four restrained syntax palettes for Markdown, LaTeX and Typst. Completion popups follow the window instead of staying white in dark mode; typed matches keep uniform size and weight.
- Readable text on filled accent buttons, quieter command selection and coordinated diagnostic colors.
- Typst and PDF pages sit on a theme-derived surrounding surface; compiled page contents are not recolored. Markdown's explicit white-paper mode keeps readable links under dark app themes.
- The existing sidebar collapse, divider width, editor inset and focus-mode layout are unchanged.
- Clearing a custom CSS color restores the selected theme immediately. Table-conversion styles are scoped to that dialog, so they no longer leak into document code blocks or hover previews.

## Validation

- 519 frontend tests pass, including 13 new theme/appearance checks.
- New checks cover all four signature palettes' body/muted/accent/diagnostic contrast, syntax contrast on base and active-line surfaces, filled-control contrast for classic/custom accents, OS appearance, draft/cancel/save behavior, preservation of unrelated preferences, and override restoration.
- TypeScript checks and frontend production build pass.
- 126 Rust tests pass; one optional real-tool integration test is ignored in the default suite.
- Local macOS app packaging completed; `codesign --verify --deep --strict` passes. Cargo.toml and Cargo.lock match the pre-bundle backups byte-for-byte. The app is ad-hoc signed, not Apple-notarized; no developer credential work was attempted.
- App: `target/release/bundle/macos/Clavis.app`. Download archive: `target/theme-refresh/Clavis-theme-refresh-macos.zip`.
- Native visual appearance and interaction feel still require review in the actual macOS app. Automated contrast/component tests are not visual acceptance.

## Maintenance

`web/src/theme/themes.ts` owns palette data; `chromeTokens.ts` derives app surfaces and shared states; `colors.ts` contains DOM-free color math. `appTheme.ts` resolves settings and applies tokens. `editor/controller.ts` re-exports theme names/types for compatibility, but the settings dialog does not import the editor controller.

Use the existing local build script, which preserves Cargo inputs around Tauri's updater-disabled bundle step. Do not run the old Chrome-based diagnostic scripts for this project.
