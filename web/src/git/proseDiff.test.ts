import { describe, expect, it } from 'vitest';
import { normalizeLatexForDiff, proseDiff } from './proseDiff';

describe('prose word diff', () => {
  it('isolates inserted and deleted words', () => {
    expect(proseDiff('The result is small.', 'The result is very large.')).toEqual([
      { kind: 'equal', text: 'The result is ' },
      { kind: 'delete', text: 'small' },
      { kind: 'insert', text: 'very large' },
      { kind: 'equal', text: '.' },
    ]);
  });

  it('normalizes cosmetic LaTeX formatting before prose comparison', () => {
    expect(normalizeLatexForDiff('A \\emph{result}  % note\n')).toBe('A result');
  });

  it('falls back to bounded line-level output for very large prose', () => {
    const before = Array(800).fill('word').join(' ');
    const after = Array(800).fill('other').join(' ');
    expect(proseDiff(before, after).map(part => part.kind)).toEqual(['delete', 'insert']);
  });
});
