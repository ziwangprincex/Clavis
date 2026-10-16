// Applies UI theme, fonts, accent, and arbitrary color overrides to :root
// whenever the relevant settings change.
//
// The chosen theme (settings.editor_theme, possibly 'auto') is the single source
// of truth: the chrome palette derives from its ThemeSpec so toolbar/sidebar/
// preview match the editor. User-level overrides (custom UI font, accent, and
// ad-hoc --var color overrides) are layered on top so they win over the theme
// defaults. Everything lands in one managed :root rule (see theme/rootTokens.ts)
// that sits before the user stylesheet, so user.css still wins over all of it
// without needing !important.

import { useEffect } from 'react';
import { defaultSettings, type Settings } from '../store';
import { resolveLocale } from '../i18n';
import { useResolvedThemeSpec } from '../theme/appTheme';
import { accentTokens, chromeTokens, overrideTokens } from '../theme/chromeTokens';
import { setRootTokens } from '../theme/rootTokens';

export function useAppTheme(settings: Settings): void {
  const spec = useResolvedThemeSpec();

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('lang', resolveLocale(settings.ui_language));
    root.setAttribute('data-theme', spec.dark ? 'dark' : 'light');

    // One rule rebuilt from the current settings on every run; stale override
    // keys cannot survive because nothing merges with the previous state.
    // --font-display / --font-literary stay derived in tokens.css — nothing
    // here needs to re-assert them.
    const decls: Record<string, string> = {
      ...chromeTokens(spec),
      'color-scheme': spec.dark ? 'dark' : 'light',
      ...(settings.ui_font_family ? { '--font-sans': settings.ui_font_family } : {}),
      '--font-mono': settings.ui_mono_font_family || settings.editor_font_family || defaultSettings.editor_font_family,
      '--ui-font-size': `${settings.ui_font_size}px`,
      ...(settings.ui_accent_color ? accentTokens(settings.ui_accent_color, spec.dark) : {}),
      ...overrideTokens(settings.ui_color_overrides),
    };
    setRootTokens(decls);

    root.style.fontSize = `${settings.ui_font_size}px`;
    document.body.style.fontSize = `${settings.ui_font_size}px`;
  }, [
    spec,
    settings.ui_language,
    settings.ui_font_family,
    settings.ui_font_size,
    settings.ui_mono_font_family,
    settings.editor_font_family,
    settings.ui_accent_color,
    settings.ui_color_overrides,
  ]);
}
