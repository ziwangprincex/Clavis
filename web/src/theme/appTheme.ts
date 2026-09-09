// Single source of truth for app-wide theming.
//
// Historically there were two disconnected theme systems: the app chrome
// (toolbar / sidebar / tabs / preview / dialogs) read CSS tokens switched by
// `ui_theme` (dark|light|auto), while the editor used its own `editor_theme`
// (VS Code, Dracula, Nord, …). Picking "Dracula" for the editor left the chrome
// in plain dark/light — a visible mismatch.
//
// Now the *chosen theme drives everything*: we resolve one `ThemeSpec` and
// derive the chrome CSS custom properties (--bg, --panel, --text, --border,
// --selection, --accent, …) from it, so the whole window matches the editor.
// `editor_theme` is the single stored theme id and may be the sentinel 'auto'
// (follow the OS light/dark preference). `ui_theme` is no longer consulted.

import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '../store';
import { BUILTIN_THEMES, type ThemeSpec } from './themes';
import { accentTokens, chromeTokens } from './chromeTokens';
import { mix } from './colors';

/** Theme id used when `editor_theme` is 'auto' and the OS is in dark/light. */
const AUTO_DARK = 'ink';
const AUTO_LIGHT = 'paper';

/** Resolve the effective theme id, expanding the 'auto' sentinel. */
export function resolveThemeId(editorTheme: string, osDark: boolean): string {
  if (editorTheme === 'auto') return osDark ? AUTO_DARK : AUTO_LIGHT;
  return Object.hasOwn(BUILTIN_THEMES, editorTheme) ? editorTheme : AUTO_DARK;
}

/** Resolve the full ThemeSpec, applying the user's per-key color overrides. */
export function resolveThemeSpec(
  editorTheme: string,
  overrides: Record<string, string>,
  osDark: boolean,
  accent = '',
): ThemeSpec {
  const base = BUILTIN_THEMES[resolveThemeId(editorTheme, osDark)];
  const ov = overrides ?? {};
  return {
    ...base,
    ...(accent && { accent, cursor: accent, selection: mix(base.bg, accent, 0.45) }),
    ...(ov.bg && { bg: ov.bg }),
    ...(ov.fg && { fg: ov.fg }),
    ...(ov.gutter_bg && { gutterBg: ov.gutter_bg }),
    ...(ov.gutter_fg && { gutterFg: ov.gutter_fg }),
    ...(ov.active_bg && { activeBg: ov.active_bg }),
    ...(ov.cursor && { cursor: ov.cursor }),
    ...(ov.selection && { selection: ov.selection }),
  };
}

/** Keep filled buttons and selected-row tints in the same accent family. */
export function setAccent(root: HTMLElement, accent: string, dark: boolean): void {
  for (const [key, value] of Object.entries(accentTokens(accent, dark))) {
    root.style.setProperty(key, value);
  }
}

/** Apply exactly the same palette used by the Appearance samples. */
export function applyChromeTokens(spec: ThemeSpec): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(chromeTokens(spec))) {
    root.style.setProperty(key, value);
  }
  root.style.setProperty('color-scheme', spec.dark ? 'dark' : 'light');
  root.setAttribute('data-theme', spec.dark ? 'dark' : 'light');
}

/** Track the OS dark-mode preference, but only subscribe while `active`. */
export function useOsDark(active: boolean): boolean {
  const [osDark, setOsDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    if (!active || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setOsDark(mq.matches);
    setOsDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [active]);
  return osDark;
}

/**
 * The resolved ThemeSpec for the current settings. Re-resolves when the theme
 * id, its overrides, or (in 'auto' mode) the OS preference changes. Used by both
 * the chrome (useAppTheme) and the editor (EditorPane) so they never diverge.
 */
export function useResolvedThemeSpec(): ThemeSpec {
  const editorTheme = useSettingsStore(s => s.settings.editor_theme);
  const overrides = useSettingsStore(s => s.settings.editor_theme_overrides);
  const accent = useSettingsStore(s => s.settings.ui_accent_color);
  const osDark = useOsDark(editorTheme === 'auto');
  return useMemo(
    () => resolveThemeSpec(editorTheme, overrides, osDark, accent),
    [editorTheme, overrides, osDark, accent],
  );
}
