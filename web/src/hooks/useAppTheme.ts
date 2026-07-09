// Applies UI theme, fonts, accent, and arbitrary color overrides to :root
// whenever the relevant settings change. Extracted verbatim from App.tsx so the
// settings→global-CSS wiring lives in one named place.

import { useEffect } from 'react';
import { useSettingsStore, type Settings } from '../store';

export function useAppTheme(settings: Settings): void {
  // Theme (dark/light/auto) + editor-theme follow. Listens to OS scheme changes
  // only when the user picked "auto".
  useEffect(() => {
    const root = document.documentElement;

    function resolve(): 'dark' | 'light' {
      if (settings.ui_theme === 'auto') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return settings.ui_theme;
    }

    function apply() {
      const resolved = resolve();
      root.setAttribute('data-theme', resolved);

      // Editor theme follows app theme: pick a sensible default for whichever
      // mode we're in. Users who explicitly chose another editor theme keep it
      // — we only swap when the saved theme matches the "default of the other
      // mode", so manual choices stick.
      const currentEditorTheme = useSettingsStore.getState().settings.editor_theme;
      if (resolved === 'light' && currentEditorTheme === 'vscode-dark') {
        useSettingsStore.getState().patch({ editor_theme: 'vscode-light' });
      } else if (resolved === 'dark' && currentEditorTheme === 'vscode-light') {
        useSettingsStore.getState().patch({ editor_theme: 'vscode-dark' });
      }
    }

    apply();

    if (settings.ui_theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => apply();
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, [settings.ui_theme]);

  // Font + accent + arbitrary color overrides — separate effect so toggling
  // theme doesn't waste a re-run on these.
  useEffect(() => {
    const root = document.documentElement;

    if (settings.ui_font_family) {
      root.style.setProperty('--font-sans', settings.ui_font_family);
    }
    document.body.style.fontSize = `${settings.ui_font_size}px`;

    if (settings.ui_accent_color) {
      root.style.setProperty('--accent', settings.ui_accent_color);
    } else {
      root.style.removeProperty('--accent');
    }

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
    settings.ui_font_family,
    settings.ui_font_size,
    settings.ui_accent_color,
    settings.ui_color_overrides,
  ]);
}
