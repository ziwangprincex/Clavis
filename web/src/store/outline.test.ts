import { describe, it, expect } from 'vitest';
import { parseOutline, parseProjectOutline } from './outline';
import type { ProjectFile } from './project';

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

describe('parseProjectOutline', () => {
  function pf(over: Partial<ProjectFile> & { relPath: string; absPath: string }): ProjectFile {
    return { content: '', isBib: false, ...over };
  }

  it('merges headings across files, tagging each with its source file', () => {
    const files: ProjectFile[] = [
      pf({ relPath: 'main.tex', absPath: '/p/main.tex', content: '\\section{Intro}\n\\input{ch1}' }),
      pf({ relPath: 'ch1.tex', absPath: '/p/ch1.tex', content: '\\section{Body}\n\\subsection{Detail}' }),
    ];
    const out = parseProjectOutline(files);
    expect(out.map(o => [o.title, o.sourceFileAbsPath])).toEqual([
      ['Intro', '/p/main.tex'],
      ['Body', '/p/ch1.tex'],
      ['Detail', '/p/ch1.tex'],
    ]);
    // Line numbers are per-file (1-based within their own file).
    expect(out[2].line).toBe(2);
  });

  it('skips bib files and binary assets', () => {
    const files: ProjectFile[] = [
      pf({ relPath: 'main.tex', absPath: '/p/main.tex', content: '\\section{Only}' }),
      pf({ relPath: 'refs.bib', absPath: '/p/refs.bib', content: '@article{k, title={x}}', isBib: true }),
      pf({ relPath: 'fig.png', absPath: '/p/fig.png', content: '', binaryBase64: 'AAAA' }),
    ];
    const out = parseProjectOutline(files);
    expect(out.map(o => o.title)).toEqual(['Only']);
  });

  it('preserves the given file order (root first)', () => {
    const files: ProjectFile[] = [
      pf({ relPath: 'main.tex', absPath: '/p/main.tex', content: '\\chapter{A}' }),
      pf({ relPath: 'z.tex', absPath: '/p/z.tex', content: '\\chapter{B}' }),
    ];
    expect(parseProjectOutline(files).map(o => o.title)).toEqual(['A', 'B']);
  });

  it('substitutes live active-tab content over the stale snapshot', () => {
    const files: ProjectFile[] = [
      pf({ relPath: 'main.tex', absPath: '/p/main.tex', content: '\\section{Old}' }),
      pf({ relPath: 'ch1.tex', absPath: '/p/ch1.tex', content: '\\section{Chapter}' }),
    ];
    // The user edited main.tex in the editor; the snapshot still says "Old".
    const out = parseProjectOutline(files, '/p/main.tex', '\\section{New}\n\\section{Extra}');
    expect(out.map(o => o.title)).toEqual(['New', 'Extra', 'Chapter']);
  });

  it('matches the active file with \\\\?\\ vs plain path normalization', () => {
    const files: ProjectFile[] = [
      pf({ relPath: 'main.tex', absPath: '\\\\?\\C:\\p\\main.tex', content: '\\section{Stale}' }),
    ];
    const out = parseProjectOutline(files, 'C:\\p\\main.tex', '\\section{Live}');
    expect(out.map(o => o.title)).toEqual(['Live']);
  });
});
