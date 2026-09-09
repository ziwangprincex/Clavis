import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../store/settings';
import { fontStack, missingFonts, previewTypography } from './typography';
import { selectionFill } from '../editor/controller';
import { resolveThemeSpec } from './appTheme';
import { chromeTokens } from './chromeTokens';

const style = (settings = defaultSettings) => previewTypography(settings) as Record<string, string | number>;
describe('complete font inheritance', () => {
  it('never forces headings or quotes into a serif stack', () => {
    const css = style({ ...defaultSettings, preview_font_family: 'PingFang SC' });
    expect(css.fontFamily).toBe('PingFang SC');
    for (let i = 1; i <= 6; i++) expect(css[`--h${i}-font`]).toBe('inherit');
    expect(css['--quote-font']).toBe('inherit');
  });
  it('independently controls all headings, quote and both code styles', () => {
    const css = style({ ...defaultSettings,
      preview_heading_fonts: { h1: 'Palatino', h6: 'PingFang SC' }, preview_heading_sizes: { h1: 3 }, preview_heading_weights: { h1: 400 },
      preview_quote_font_family: 'Songti SC', preview_inline_code_font_family: 'Menlo', preview_code_font_family: 'Consolas',
      preview_line_height: 2,
    });
    expect(css).toMatchObject({ '--h1-font': 'Palatino', '--h6-font': 'PingFang SC', '--h2-font': 'inherit', '--h1-size': '3em', '--h1-weight': 400,
      '--quote-font': 'Songti SC', '--inline-code-font': 'Menlo', '--code-font': 'Consolas', lineHeight: 2 });
  });
  it('code follows the selected editor font rather than a separate hardcoded stack', () => {
    const css = style({ ...defaultSettings, editor_font_family: 'My Mono' });
    expect(css['--code-font']).toBe('My Mono');
    expect(css['--inline-code-font']).toBe('My Mono');
  });
  it('quotes a selected family and lists only missing explicit font names', () => {
    expect(fontStack('Font "Name"')).toBe('"Font \\"Name\\""');
    expect(missingFonts('"PingFang SC", "Missing Font", sans-serif, -apple-system', ['pingfang sc'])).toEqual(['Missing Font']);
  });
});

describe('accent has one source across editor and chrome', () => {
  it('custom accent drives cursor, selection, controls and links', () => {
    const spec = resolveThemeSpec('paper', {}, false, '#8855aa');
    const css = chromeTokens(spec);
    expect(spec.accent).toBe('#8855aa');
    expect(spec.cursor).toBe('#8855aa');
    expect(css['--accent']).toBe(spec.accent);
    expect(css['--selection']).toBe(spec.selection);
  });
  it('an explicit editor selection override still wins', () => {
    expect(resolveThemeSpec('paper', { selection: '#334455' }, false, '#8855aa').selection).toBe('#334455');
  });
});


describe('editor selection paint', () => {
  it('is translucent so text under the raised selection layer stays visible', () => {
    const spec = resolveThemeSpec('dusk', {}, true);
    expect(selectionFill(spec, true)).toMatch(/^rgba\(\d+, \d+, \d+, 0\.7\)$/);
    expect(selectionFill(spec, false)).toMatch(/^rgba\(\d+, \d+, \d+, 0\.5\)$/);
    expect(selectionFill(resolveThemeSpec('paper', { selection: '#334455' }, false), true)).toBe('rgba(51, 68, 85, 0.7)');
  });
});
