import type { ThemeSpec } from './themes';
import { mix, onAccent, readableMix, withAlpha } from './colors';

export function accentTokens(accent: string, dark: boolean): Record<string, string> {
  const hover = mix(accent, dark ? '#ffffff' : '#000000', 0.12);
  return {
    '--accent': accent,
    '--accent-hover': hover,
    '--on-accent': onAccent(accent),
    '--on-accent-hover': onAccent(hover),
    '--tint-accent': withAlpha(accent, dark ? 0.14 : 0.09),
  };
}

/** Flat document, recessed workspace, lifted popovers. No translucent chrome. */
export function chromeTokens(spec: ThemeSpec): Record<string, string> {
  const { bg, fg, dark } = spec;
  const panel = mix(bg, fg, dark ? 0.025 : 0.038);
  const elevated = dark ? mix(bg, fg, 0.065) : mix(bg, '#ffffff', 0.72);
  const desk = mix(bg, fg, dark ? 0.015 : 0.055);
  const textSurface = dark ? elevated : desk;
  const error = dark ? '#e5a09a' : '#a33d39';
  const warning = dark ? '#d9b77c' : '#8d621f';
  const ok = dark ? '#a5beac' : '#466d58';
  return {
    '--bg': bg,
    '--bg-elevated': elevated,
    '--bg-overlay': dark ? 'rgba(9, 11, 15, 0.60)' : 'rgba(25, 29, 35, 0.22)',
    '--panel': panel,
    '--panel-solid': panel,
    '--panel-soft': withAlpha(fg, dark ? 0.055 : 0.045),
    '--preview-desk': desk,
    '--border': withAlpha(fg, dark ? 0.10 : 0.09),
    '--border-strong': withAlpha(fg, dark ? 0.24 : 0.20),
    '--text': fg,
    '--text-muted': readableMix(textSurface, fg, 0.65),
    '--text-dim': readableMix(textSurface, fg, 0.46, 3),
    '--selection': spec.selection,
    '--error': error,
    '--warning': warning,
    '--ok': ok,
    '--tint-error': withAlpha(error, 0.10),
    '--tint-warning': withAlpha(warning, 0.10),
    '--shadow-sm': dark ? '0 1px 2px rgba(0, 0, 0, 0.24)' : '0 1px 2px rgba(24, 30, 38, 0.06)',
    '--shadow-md': dark ? '0 12px 40px rgba(0, 0, 0, 0.32)' : '0 12px 40px rgba(24, 30, 38, 0.12)',
    ...accentTokens(spec.accent, dark),
  };
}
