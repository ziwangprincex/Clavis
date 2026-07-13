// Applies UI theme, fonts, accent, and arbitrary color overrides to :root
// whenever the relevant settings change.
//
// The chosen theme (settings.editor_theme, possibly 'auto') is the single source
// of truth: `applyChromeTokens` derives the whole chrome palette from its
// ThemeSpec so toolbar/sidebar/preview match the editor. User-level overrides
// (custom UI font, accent, and ad-hoc --var color overrides) are then layered on
// top so they win over the theme defaults.

import { useEffect } from 'react';
import { type Settings } from '../store';
import { applyChromeTokens, setAccent, useResolvedThemeSpec } from '../theme/appTheme';

export function useAppTheme(settings: Settings): void {
  const spec = useResolvedThemeSpec();

  useEffect(() => {
    const root = document.documentElement;

    // 1) Theme-derived chrome palette (also sets data-theme + color-scheme).
    applyChromeTokens(spec);

    // 2) User font overrides.
    if (settings.ui_font_family) {
      root.style.setProperty('--font-sans', settings.ui_font_family);
    } else {
      root.style.removeProperty('--font-sans');
    }
    document.body.style.fontSize = `${settings.ui_font_size}px`;

    // 3) User accent override wins over the theme's accent.
    if (settings.ui_accent_color) {
      setAccent(root, settings.ui_accent_color, spec.dark);
    }

    // 4) Arbitrary --var color overrides, layered last so they always win.
    const ov = settings.ui_color_overrides ?? {};
    const knownKeys: string[] = (root.dataset.clavisOverrideKeys ?? '').split(',').filter(Boolean);
    for (const key of knownKeys) {
      if (!(key in ov)) root.style.removeProperty(`--${key}`);
    }
    for (const [key, value] of Object.entries(ov)) {
      if (value) root.style.setProperty(`--${key}`, value);
    }
    root.dataset.clavisOverrideKeys = Object.keys(ov).join(',');
  }, [
    spec,
    settings.ui_font_family,
    settings.ui_font_size,
    settings.ui_accent_color,
    settings.ui_color_overrides,
  ]);
}
