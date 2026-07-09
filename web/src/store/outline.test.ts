import { describe, it, expect } from 'vitest';
import { parseOutline } from './outline';

describe('parseOutline — markdown', () => {
  it('extracts ATX headings with correct 0-based levels and 1-based lines', () => {
    const src = ['# Title', 'text', '## Section', '### Sub'].join('\n');
    const out = parseOutline(src, 'markdown');
    expect(out).toEqual([
      { level: 0, title: 'Title', line: 1 },
      { level: 1, title: 'Section', line: 3 },
      { level: 2, title: 'Sub', line: 4 },
    ]);
  });

  it('ignores headings inside fenced code blocks', () => {
    const src = ['# Real', '```', '# fake in fence', '```', '## Also real'].join('\n');
    const out = parseOutline(src, 'markdown');
    expect(out.map(o => o.title)).toEqual(['Real', 'Also real']);
  });

  it('strips trailing hashes from closed ATX headings', () => {
    const out = parseOutline('# Title #', 'markdown');
    expect(out[0].title).toBe('Title');
  });

  it('supports ~~~ fences too', () => {
    const src = ['~~~', '# hidden', '~~~', '# shown'].join('\n');
    expect(parseOutline(src, 'markdown').map(o => o.title)).toEqual(['shown']);
  });
});

describe('parseOutline — latex', () => {
  it('maps sectioning commands to their levels', () => {
    const src = [
      '\\part{P}',
      '\\chapter{C}',
      '\\section{S}',
      '\\subsection{Sub}',
      '\\subsubsection{SubSub}',
    ].join('\n');
    const out = parseOutline(src, 'latex');
    expect(out.map(o => o.level)).toEqual([0, 1, 2, 3, 4]);
    expect(out.map(o => o.title)).toEqual(['P', 'C', 'S', 'Sub', 'SubSub']);
  });

  it('handles starred variants and comment lines', () => {
    const src = ['% \\section{commented out}', '\\section*{Unnumbered}'].join('\n');
    const out = parseOutline(src, 'latex');
    expect(out).toEqual([{ level: 2, title: 'Unnumbered', line: 2 }]);
  });

  it('captures multiple sectioning commands on one line', () => {
    const out = parseOutline('\\section{A}\\subsection{B}', 'latex');
    expect(out.map(o => o.title)).toEqual(['A', 'B']);
    expect(out.every(o => o.line === 1)).toBe(true);
  });
});

describe('parseOutline — typst', () => {
  it('reads = heading markers as levels', () => {
    const src = ['= Top', '== Second', '=== Third'].join('\n');
    const out = parseOutline(src, 'typst');
    expect(out).toEqual([
      { level: 0, title: 'Top', line: 1 },
      { level: 1, title: 'Second', line: 2 },
      { level: 2, title: 'Third', line: 3 },
    ]);
  });

  it('ignores = that is not a heading marker', () => {
    // No space after = → not a heading.
    expect(parseOutline('=notheading', 'typst')).toEqual([]);
  });
});
