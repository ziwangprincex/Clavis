import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, SIGNATURE_THEMES, syntaxPalette } from './themes';
import { accentTokens, chromeTokens } from './chromeTokens';
import { contrast, hexToRgb, luminance, mix, withAlpha } from './colors';
import { resolveThemeId, resolveThemeSpec } from './appTheme';

describe('quiet writing palettes', () => {
  it('follows the OS without migrating explicit user choices', () => {
    expect(resolveThemeId('auto', false)).toBe('paper');
    expect(resolveThemeId('auto', true)).toBe('ink');
    for (const id of Object.keys(BUILTIN_THEMES)) {
      expect(resolveThemeId(id, true)).toBe(id);
      expect(resolveThemeId(id, false)).toBe(id);
    }
    for (const id of ['missing', 'constructor', '__proto__']) {
      expect(resolveThemeId(id, false)).toBe('ink');
    }
  });

  it('retains custom colors without mutating the built-in palette', () => {
    const spec = resolveThemeSpec('paper', { bg: '#ffffff', fg: '#111111', cursor: '#aabbcc' }, false);
    expect(spec.bg).toBe('#ffffff');
    expect(spec.cursor).toBe('#aabbcc');
    expect(BUILTIN_THEMES.paper.bg).toBe('#fbfbf9');
    expect(spec.syntax).toEqual(BUILTIN_THEMES.paper.syntax);
  });

  for (const id of SIGNATURE_THEMES) {
    const spec = BUILTIN_THEMES[id];
    const tokens = chromeTokens(spec);
    it(`${id}: readable text and restrained, legible syntax`, () => {
      for (const surface of ['--bg', '--panel', '--bg-elevated', '--preview-desk']) {
        expect(contrast(tokens['--text'], tokens[surface])).toBeGreaterThanOrEqual(7);
        expect(contrast(tokens['--text-muted'], tokens[surface])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--accent'], tokens[surface])).toBeGreaterThanOrEqual(4.5);
        for (const severity of ['--error', '--warning', '--ok']) {
          expect(contrast(tokens[severity], tokens[surface])).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const color of Object.values(spec.syntax!)) {
        expect(contrast(color, spec.bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color, spec.activeBg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(spec.gutterFg, spec.bg)).toBeGreaterThanOrEqual(3);
      expect(tokens['--panel']).toBe(tokens['--panel-solid']);
      expect(tokens['--panel']).not.toBe(tokens['--bg']);
      expect(tokens['--bg-elevated']).not.toBe(tokens['--panel']);
      expect(tokens['--tint-accent']).toBe(withAlpha(spec.accent, spec.dark ? 0.14 : 0.09));
    });
    // Three levels: the frame (sidebar and bars) recedes from the page, and
    // what floats is lighter than both. A step under 1.1 reads as one plane.
    it(`${id}: the frame, the page and floating surfaces are told apart by tone`, () => {
      expect(contrast(tokens['--panel'], tokens['--bg'])).toBeGreaterThanOrEqual(1.1);
      expect(luminance(tokens['--bg-elevated'])).toBeGreaterThan(luminance(tokens['--bg']));
      if (spec.dark) expect(contrast(tokens['--bg-elevated'], tokens['--panel'])).toBeGreaterThanOrEqual(1.1);
    });
  }

  it('keeps filled controls readable for every theme and custom accent', () => {
    const accents = [...Object.values(BUILTIN_THEMES).map(s => s.accent), '#fff', '#000', '#123456', '#aabbcc'];
    for (const accent of accents) {
      for (const dark of [false, true]) {
        const tokens = accentTokens(accent, dark);
        expect(contrast(tokens['--accent'], tokens['--on-accent'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--accent-hover'], tokens['--on-accent-hover'])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('derives a legible, theme-owned syntax palette for every community theme', () => {
    for (const [id, spec] of Object.entries(BUILTIN_THEMES)) {
      const syntax = syntaxPalette(spec);
      if (spec.syntax) expect(syntax).toBe(spec.syntax);
      const activeMinimum = Math.min(4.5, contrast(spec.fg, spec.activeBg));
      for (const color of Object.values(syntax)) {
        expect(contrast(color, spec.bg), `${id} on bg`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color, spec.activeBg), `${id} on active line`).toBeGreaterThanOrEqual(activeMinimum);
      }
      // Solarized is low-contrast by design; only themes with real headroom must
      // keep names, keywords and literals visibly distinct.
      if (contrast(spec.fg, spec.bg) >= 7) expect(new Set(Object.values(syntax)).size, id).toBeGreaterThanOrEqual(3);
    }
  });

  it('rejects malformed hex rather than treating partial input as a valid color', () => {
    expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb('#12zzzz')).toBeNull();
    expect(hexToRgb('#12345678')).toBeNull();
    expect(mix('#000', '#fff', 0.5)).toBe('#808080');
    expect(withAlpha('transparent', 0.1)).toBe('transparent');
  });
});


it('keeps default surfaces nearly neutral while retaining theme choices and readable syntax', () => {
  for (const id of ['paper', 'ink']) {
    const spec = BUILTIN_THEMES[id];
    // A trace of warmth or coolness, never a visible tint such as cream.
    for (const color of [spec.bg, spec.gutterBg, spec.activeBg]) {
      const { r, g, b } = hexToRgb(color)!;
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${id} ${color}`).toBeLessThanOrEqual(5);
    }
    expect(new Set(Object.values(syntaxPalette(spec))).size).toBeGreaterThanOrEqual(3);
  }
  expect(BUILTIN_THEMES.mist).toBeDefined();
  expect(BUILTIN_THEMES.dusk).toBeDefined();
});
