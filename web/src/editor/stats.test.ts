import { describe, it, expect } from 'vitest';
import { computeResearchDetailStats, computeResearchStats, computeStats, countChars, countLines, countWords } from './stats';

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


describe('computeResearchDetailStats', () => {
  it('estimates selected and current Markdown section prose separately from captions and notes', () => {
    const text = '# Intro\nMain prose here.\n![Chart caption](chart.png)\n[^1]: Note prose.\n# Results\nResult words here.';
    const stats = computeResearchDetailStats(text, 'markdown', text.indexOf('Main'), { from: text.indexOf('Main'), to: text.indexOf('here.') + 5 });
    expect(stats.selectionWords).toBe(3);
    expect(stats.sectionWords).toBeGreaterThanOrEqual(3);
    expect(stats.captionWords).toBe(2);
    expect(stats.footnoteWords).toBe(2);
  });

  it('recognizes common LaTeX and Typst caption/footnote forms without evaluating source', () => {
    const latex = computeResearchDetailStats('\\section{A} prose \\caption{Table caption} \\footnote{Note text}', 'latex', 15);
    expect(latex.captionWords).toBe(2); expect(latex.footnoteWords).toBe(2);
    const typst = computeResearchDetailStats('= A\nprose #figure(image("x"), caption: [Figure caption]) #footnote[Note text]', 'typst', 5);
    expect(typst.captionWords).toBe(2); expect(typst.footnoteWords).toBe(2);
  });
});
