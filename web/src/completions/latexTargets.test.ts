import { describe, expect, it } from 'vitest';
import { bibDetail, bibSummaries, flatten, labelSummaries, shortAuthor } from './latexTargets';
import { latexSemanticProvider } from './latexSemanticProvider';

const bib = `@book{knuth1984,
  author = {Knuth, Donald E.},
  title = {The {\\TeX}book},
  year = 1984,
}
@article{lamport,
  author = "Leslie Lamport and Donald Knuth and Someone Else",
  title = {{LaTeX}: A Document Preparation System},
  date = {1994-06-01}
}`;

const tex = `\\section{Introduction}\\label{sec:intro}
Text.
% \\label{commented}
\\begin{table}[h]
  \\centering
  \\caption{A small \\emph{table}}\\label{tab:small}
\\end{table}
\\begin{equation}
  E = mc^2 \\label{eq:energy}
\\end{equation}
\\begin{figure}
  \\label{fig:before-caption}
  \\caption{Caption after the label}
\\end{figure}`;

const docs = [
  { path: '/p/refs.bib', language: 'latex' as const, text: bib },
  { path: '/p/main.tex', language: 'latex' as const, text: tex },
];

describe('citation and label summaries', () => {
  it('reads author, year and title from bib entries', () => {
    const entries = bibSummaries(docs);
    expect(entries.map(entry => [entry.key, bibDetail(entry), entry.title, entry.line])).toEqual([
      ['knuth1984', 'Knuth 1984', 'The TeXbook', 1],
      ['lamport', 'Lamport et al. 1994', 'LaTeX: A Document Preparation System', 6],
    ]);
    expect(shortAuthor('Donald Knuth and Leslie Lamport')).toBe('Knuth & Lamport');
    expect(flatten("Schr\\\"{o}dinger~{\\'E}quations")).toBe('Schrodinger Equations');
  });

  it('says what each label belongs to', () => {
    const strip = (text: string) => text.split('\n').map(line => line.replace(/(?<!\\)%.*$/, '')).join('\n');
    expect(labelSummaries(docs, strip).map(item => [item.label, item.kind, item.text, item.line])).toEqual([
      ['sec:intro', 'Section', 'Introduction', 1],
      ['tab:small', 'Table', 'A small table', 6],
      ['eq:energy', 'Equation', 'E = mc^2', 9],
      ['fig:before-caption', 'Figure', 'Caption after the label', 12],
    ]);
  });

  it('puts the summary in the completion detail and info', async () => {
    const request = {
      language: 'latex' as const, text: '\\cite{', position: 6, explicit: true,
      workspace: { rootPath: '/p/main.tex', activePath: '/p/main.tex', documents: docs },
    };
    const cites = await latexSemanticProvider.complete(request, { kind: 'citation', from: 6, to: 6, query: '' });
    expect(cites[0]).toMatchObject({ label: 'knuth1984', detail: 'Knuth 1984', source: { path: '/p/refs.bib', line: 1 } });
    expect(cites[0].info).toBe('The TeXbook\nKnuth, Donald E.\n1984');
    const refs = await latexSemanticProvider.complete({ ...request, text: tex }, { kind: 'reference', from: 0, to: 0, query: '' });
    expect(refs.find(item => item.label === 'tab:small')).toMatchObject({ detail: 'Table · A small table', info: 'Table: A small table' });
    expect(refs.some(item => item.label === 'commented')).toBe(false);
  });
});
