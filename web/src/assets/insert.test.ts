import { describe, expect, it } from 'vitest';
import { assetFigureTemplate, assetInsertText } from './insert';

describe('asset insertion text', () => {
  it('uses each authoring language native image syntax', () => {
    expect(assetInsertText('figures/chart.png', 'latex')).toBe('\\includegraphics{figures/chart.png}');
    expect(assetInsertText('figures/chart.png', 'typst')).toBe('#image("figures/chart.png")');
    expect(assetInsertText('figures/chart.png', 'markdown')).toBe('![](figures/chart.png)');
  });

  it('escapes only syntax-significant path characters', () => {
    expect(assetInsertText('fig ures/a#b%.png', 'latex')).toBe('\\includegraphics{fig ures/a\\#b\\%.png}');
    expect(assetInsertText('figures/a"b.png', 'typst')).toBe('#image("figures/a\\"b.png")');
    expect(assetInsertText('figures/a (draft).png', 'markdown')).toBe('![](figures/a%20\\(draft\\).png)');
  });

  it('builds manuscript figure templates without touching the asset', () => {
    expect(assetFigureTemplate('figures/chart.png', 'latex')).toContain('\\label{fig:label}');
    expect(assetFigureTemplate('figures/chart.png', 'typst')).toContain('<fig:label>');
    expect(assetFigureTemplate('figures/chart.png', 'markdown')).toBe('![Caption](figures/chart.png){#fig:label}');
  });
});
