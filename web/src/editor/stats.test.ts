import { describe, it, expect } from 'vitest';
import { computeResearchStats, computeStats, countChars, countLines, countWords } from './stats';

describe('countLines', () => {
  it('returns 1 for empty string (a blank doc still shows Ln 1)', () => {
    expect(countLines('')).toBe(1);
  });
  it('counts \\n and adds 1', () => {
    expect(countLines('a')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\n')).toBe(3); // trailing newline creates a phantom line
  });
});

describe('countWords', () => {
  it('is 0 for empty and whitespace-only', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t  ')).toBe(0);
  });
  it('splits on any whitespace run', () => {
    expect(countWords('one')).toBe(1);
    expect(countWords('one two')).toBe(2);
    expect(countWords('  one\ttwo\n\nthree ')).toBe(3);
  });
  it('treats hyphenated tokens as one word', () => {
    expect(countWords('well-known thing')).toBe(2);
  });
});

describe('countChars', () => {
  it('returns JS string length (matches VS Code)', () => {
    expect(countChars('')).toBe(0);
    expect(countChars('abc')).toBe(3);
    expect(countChars('a\nb')).toBe(3);
  });
});

describe('computeStats', () => {
  it('bundles the three counts', () => {
    expect(computeStats('hello world\nsecond line')).toEqual({
      words: 4,
      chars: 23,
      lines: 2,
    });
  });
});


describe('computeResearchStats', () => {
  it('excludes Markdown front matter, code, math and URLs while finding Abstract', () => {
    const stats = computeResearchStats('---\ntitle: T\n---\n# Abstract\nThis is the abstract.\n\n# Main\nText with [link](https://x.test) and $x^2$.\n```r\ncode\n```', 'markdown');
    expect(stats.abstractWords).toBe(4);
    expect(stats.mainWords).toBe(5);
  });

  it('counts multi-paragraph Markdown and Typst abstracts until the next section', () => {
    expect(computeResearchStats(`# Abstract
First paragraph.

Second paragraph.
# Main
Main text.`, 'markdown').abstractWords).toBe(4);
    expect(computeResearchStats(`= Abstract
First paragraph.

Second paragraph.
= Main
Main text.`, 'typst').abstractWords).toBe(4);
  });

  it('keeps LaTeX prose arguments but excludes citations, math and abstract environment from main estimate', () => {
    const stats = computeResearchStats('\\begin{abstract}Short abstract text.\\end{abstract}\n\\section{Intro} Plain \\emph{prose} \\cite{key} $x^2$', 'latex');
    expect(stats.abstractWords).toBe(3);
    expect(stats.mainWords).toBeGreaterThanOrEqual(3);
  });

  it('handles Typst markup, code calls and math', () => {
    const stats = computeResearchStats('= Abstract\nShort abstract text.\n= Main\nVisible #image("x.png") prose $x^2$.', 'typst');
    expect(stats.abstractWords).toBe(3);
    expect(stats.mainWords).toBe(3);
  });
});
