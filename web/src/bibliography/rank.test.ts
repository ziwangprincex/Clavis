import { describe, expect, it } from 'vitest';
import type { BibEntry } from '../api/tauri';
import { indexBibliography, rankBibliography } from './rank';

function entry(key: string, patch: Partial<BibEntry> = {}): BibEntry {
  return { key, entryType: 'article', keywords: [], sourceFile: 'refs.bib', sourceLine: 1, sourceEndLine: 2, ...patch };
}

describe('bibliography ranking', () => {
  const entries = [
    entry('card1994', { author: 'Card, David and Krueger, Alan', year: '1994', title: 'Minimum Wages and Employment', journal: 'American Economic Review', keywords: ['labor'] }),
    entry('acemoglu2001', { author: 'Acemoglu, Daron', year: '2001', title: 'The Colonial Origins of Comparative Development', keywords: ['institutions'] }),
    entry('dube2010', { author: 'Dube, Arindrajit', year: '2010', title: 'Minimum Wage Effects Across State Borders' }),
  ];

  it('requires every token and searches across author/title/year', () => {
    const result = rankBibliography(indexBibliography(entries), 'card minimum 1994', new Map(), []);
    expect(result.map(item => item.entry.key)).toEqual(['card1994']);
  });

  it('ranks exact keys above metadata matches', () => {
    const result = rankBibliography(indexBibliography([...entries, entry('minimum', { title: 'Other' })]), 'minimum', new Map(), []);
    expect(result[0].entry.key).toBe('minimum');
  });

  it('uses recent and project frequency only as secondary ranking', () => {
    const usage = new Map([['dube2010', 4], ['card1994', 1]]);
    expect(rankBibliography(indexBibliography(entries), '', usage, ['card1994'])[0].entry.key).toBe('card1994');
    expect(rankBibliography(indexBibliography(entries), 'minimum', usage, [])[0].entry.key).toBe('dube2010');
  });
});
