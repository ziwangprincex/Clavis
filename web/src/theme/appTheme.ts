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
import { BUILTIN_THEMES, type ThemeSpec } from '../editor/controller';

/** Theme id used when `editor_theme` is 'auto' and the OS is in dark/light. */
const AUTO_DARK = 'vscode-dark';
const AUTO_LIGHT = 'vscode-light';

/** Resolve the effective theme id, expanding the 'auto' sentinel. */
export function resolveThemeId(editorTheme: string, osDark: boolean): string {
  if (editorTheme === 'auto') return osDark ? AUTO_DARK : AUTO_LIGHT;
  return editorTheme in BUILTIN_THEMES ? editorTheme : AUTO_DARK;
}

/** Resolve the full ThemeSpec, applying the user's per-key color overrides. */
export function resolveThemeSpec(
  editorTheme: string,
  overrides: Record<string, string>,
  osDark: boolean,
): ThemeSpec {
  const base = BUILTIN_THEMES[resolveThemeId(editorTheme, osDark)];
  const ov = overrides ?? {};
  return {
    ...base,
    ...(ov.bg && { bg: ov.bg }),
    ...(ov.fg && { fg: ov.fg }),
    ...(ov.gutter_bg && { gutterBg: ov.gutter_bg }),
    ...(ov.gutter_fg && { gutterFg: ov.gutter_fg }),
    ...(ov.active_bg && { activeBg: ov.active_bg }),
    ...(ov.cursor && { cursor: ov.cursor }),
    ...(ov.selection && { selection: ov.selection }),
  };
}

// ---- small color helpers (all inputs are #rgb / #rrggbb hex) ----

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length < 6) return null;
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** `hex` at the given alpha as an rgba() string; falls back to `hex` verbatim. */
function withAlpha(hex: string, a: number): string {
  const c = hexToRgb(hex);
  return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${a})` : hex;
}

/** Blend `hex` toward `toward` by `t` (0..1), returning a solid #rrggbb. */
function mix(hex: string, toward: string, t: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(toward);
  if (!a || !b) return hex;
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t);
  const to2 = (v: number) => v.toString(16).padStart(2, '0');
  return `#${to2(ch(a.r, b.r))}${to2(ch(a.g, b.g))}${to2(ch(a.b, b.b))}`;
}

/** Apply an accent + a matching hover shade to :root. */
export function setAccent(root: HTMLElement, accent: string, dark: boolean): void {
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-hover', mix(accent, dark ? '#ffffff' : '#000000', 0.22));
}

/**
 * Derive the chrome CSS custom properties from a ThemeSpec and set them inline
 * on :root (inline styles win over the [data-theme] rules in tokens.css, so the
 * theme always drives the actual colors). Every surface is built from the
 * editor's *base* background (`bg`) so the toolbar/sidebar/preview stay the same
 * color family as the editor — panels get only a barely-there lift to separate
 * them. (We deliberately do NOT use `activeBg` here: in many themes that's the
 * much-lighter active-line/selection shade, e.g. Dracula #44475a vs bg #282a36,
 * which made the chrome look like a different color from the editor.)
 * Text/border shades come from the foreground so contrast tracks the theme.
 */
export function applyChromeTokens(spec: ThemeSpec): void {
  const root = document.documentElement;
  const { bg, fg, selection, dark } = spec;

  root.style.setProperty('--bg', bg);
  root.style.setProperty('--bg-elevated', mix(bg, fg, 0.07));
  root.style.setProperty('--bg-overlay', dark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.25)');

  root.style.setProperty('--panel', mix(bg, fg, 0.035));
  root.style.setProperty('--panel-solid', mix(bg, fg, 0.035));
  root.style.setProperty('--panel-soft', withAlpha(fg, 0.05));

  root.style.setProperty('--border', withAlpha(fg, 0.12));
  root.style.setProperty('--border-strong', withAlpha(fg, 0.22));

  root.style.setProperty('--text', fg);
  root.style.setProperty('--text-muted', withAlpha(fg, 0.62));
  root.style.setProperty('--text-dim', withAlpha(fg, 0.35));

  root.style.setProperty('--selection', selection);
  root.style.setProperty('--material-edge', dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.7)');

  setAccent(root, spec.accent, dark);
  root.style.setProperty('color-scheme', dark ? 'dark' : 'light');
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
}

/** Track the OS dark-mode preference, but only subscribe while `active`. */
export function useOsDark(active: boolean): boolean {
  const [osDark, setOsDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    if (!active) return;
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
  const osDark = useOsDark(editorTheme === 'auto');
  return useMemo(
    () => resolveThemeSpec(editorTheme, overrides, osDark),
    [editorTheme, overrides, osDark],
  );
}
