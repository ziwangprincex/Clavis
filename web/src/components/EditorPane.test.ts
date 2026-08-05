import { describe, expect, it } from 'vitest';
import { citationText, citationsText } from './citationText';

describe('language-aware citation insertion', () => {
  it('uses native syntax for LaTeX, Typst and Pandoc Markdown', () => {
    expect(citationText('smith2020', 'latex')).toBe('\\cite{smith2020}');
    expect(citationText('smith2020', 'typst')).toBe('@smith2020');
    expect(citationText('smith2020', 'markdown')).toBe('[@smith2020]');
  });

  it('formats multiple keys without duplicates', () => {
    expect(citationsText(['a', 'b', 'a'], 'latex')).toBe('\\cite{a, b}');
    expect(citationsText(['a', 'b'], 'typst')).toBe('@a @b');
    expect(citationsText(['a', 'b'], 'markdown')).toBe('[@a; @b]');
  });
});
