import { describe, expect, it } from 'vitest';
import { complete } from './engine';
import type { CompletionRequest, CompletionWorkspace } from './types';

const mainDocument = String.raw`\documentclass{article}
\newenvironment{warningbox}{}{}
\begin{document}
\section{Intro}\label{sec:intro}
\end{document}`;

const workspace: CompletionWorkspace = {
  rootPath: 'C:/paper/main.tex',
  activePath: 'C:/paper/main.tex',
  documents: [
    {
      path: 'C:/paper/main.tex',
      language: 'latex',
      text: mainDocument,
    },
    {
      path: 'C:/paper/refs.bib',
      language: 'latex',
      text: '@article{knuth1984, title={Literate Programming}}',
    },
    {
      path: 'C:/paper/chapters/method.tex',
      language: 'latex',
      text: String.raw`\label{sec:method}`,
    },
  ],
};

function request(text: string, extra: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    language: 'latex',
    text,
    position: text.length,
    explicit: false,
    workspace,
    ...extra,
  };
}

describe('completion engine', () => {
  it('completes citations from project BibTeX documents', async () => {
    const result = await complete(request(String.raw`See \cite{knu`));

    expect(result?.from).toBe(String.raw`See \cite{`.length);
    expect(result?.candidates).toContainEqual(expect.objectContaining({
      label: 'knuth1984',
      insertText: 'knuth1984',
      kind: 'citation',
    }));
  });

  it('completes references from every project document', async () => {
    const result = await complete(request(mainDocument + String.raw`\nSee \ref{sec:`));

    expect(result?.candidates.map(candidate => candidate.label)).toEqual(
      expect.arrayContaining(['sec:intro', 'sec:method']),
    );
  });

  it('includes custom environments declared in the project', async () => {
    const result = await complete(request(mainDocument + String.raw`\n\begin{warn`));

    expect(result?.from).toBe((mainDocument + String.raw`\n`).length);
    expect(result?.candidates).toContainEqual(expect.objectContaining({
      label: String.raw`\begin{warningbox}`,
      kind: 'environment',
    }));
  });

  it('ranks the nearest open environment first when completing end', async () => {
    const text = String.raw`\begin{document}
\begin{itemize}
\end{`;
    const result = await complete(request(text));

    expect(result?.candidates[0]?.label).toBe(String.raw`\end{itemize}`);
  });

  it('completes project paths according to the LaTeX command', async () => {
    const input = await complete(request(String.raw`\input{chap`));
    const bibliography = await complete(request(String.raw`\addbibresource{ref`));

    expect(input?.candidates).toContainEqual(expect.objectContaining({ label: 'chapters/method' }));
    expect(bibliography?.candidates).toContainEqual(expect.objectContaining({ label: 'refs.bib' }));
  });

  it('keeps the exact active text fresher than the Workspace snapshot', async () => {
    const result = await complete(request(String.raw`\label{fresh}\nSee \ref{fre`));

    expect(result?.candidates).toContainEqual(expect.objectContaining({ label: 'fresh' }));
  });

  it('accepts asynchronous providers for a future language-server adapter', async () => {
    const result = await complete(request(String.raw`\sec`), [{
      async complete() {
        return [{
          label: String.raw`\section`,
          insertText: String.raw`\section{$1}`,
          kind: 'command',
          snippet: true,
        }];
      },
    }]);

    expect(result?.candidates).toContainEqual(expect.objectContaining({
      label: String.raw`\section`,
    }));
  });

  it('does not offer package-defined environments before their package is loaded', async () => {
    const bare = await complete(request(String.raw`\documentclass{article}
\begin{ali`));
    expect(bare?.candidates.map(candidate => candidate.label) ?? [])
      .not.toContain(String.raw`\begin{align}`);

    const amsmath = await complete(request(String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{ali`));
    expect(amsmath?.candidates.map(candidate => candidate.label) ?? [])
      .toContain(String.raw`\begin{align}`);
  });

  it('offers math child environments only inside math mode', async () => {
    const prose = await complete(request(String.raw`\usepackage{amsmath}
\begin{cas`));
    expect(prose?.candidates.map(candidate => candidate.label) ?? [])
      .not.toContain(String.raw`\begin{cases}`);

    const math = await complete(request(String.raw`\usepackage{amsmath}
\[
\begin{cas`));
    expect(math?.candidates.map(candidate => candidate.label) ?? [])
      .toContain(String.raw`\begin{cases}`);
  });

  it('does not invent theorem-like environments that were never declared', async () => {
    const bare = await complete(request(String.raw`\documentclass{article}
\begin{theo`));
    expect(bare?.candidates.map(candidate => candidate.label) ?? [])
      .not.toContain(String.raw`\begin{theorem}`);

    const declared = await complete(request(String.raw`\documentclass{article}
\newtheorem{theorem}{Theorem}
\begin{theo`));
    expect(declared?.candidates.map(candidate => candidate.label) ?? [])
      .toContain(String.raw`\begin{theorem}`);
  });

  it('does not offer text environments inside math mode', async () => {
    const result = await complete(request(String.raw`\[
\begin{fig`));
    expect(result?.candidates.map(candidate => candidate.label) ?? [])
      .not.toContain(String.raw`\begin{figure}`);
  });

  it('offers item only inside list environments', async () => {
    const prose = await complete(request(String.raw`Text \it`));
    expect(prose?.candidates.map(candidate => candidate.label) ?? [])
      .not.toContain(String.raw`\item`);

    const list = await complete(request(String.raw`\begin{itemize}
\it`));
    expect(list?.candidates.map(candidate => candidate.label) ?? [])
      .toContain(String.raw`\item`);
  });

  it('offers proof skeleton only when amsthm is loaded', async () => {
    const bare = await complete(request(String.raw`\documentclass{article}
\begin{pro`));
    expect(bare?.candidates.map(candidate => candidate.label) ?? [])
      .not.toContain(String.raw`\begin{proof}`);

    const loaded = await complete(request(String.raw`\documentclass{article}
\usepackage{amsthm}
\begin{pro`));
    expect(loaded?.candidates.map(candidate => candidate.label) ?? [])
      .toContain(String.raw`\begin{proof}`);
  });

  it('does not nest display-math environments inside existing math', async () => {
    const result = await complete(request(String.raw`\usepackage{amsmath}
\[
\begin{ali`));
    expect(result?.candidates.map(candidate => candidate.label) ?? [])
      .not.toContain(String.raw`\begin{align}`);
  });

  it('does not invent closing environments', async () => {
    const result = await complete(request(String.raw`\end{theo`));
    expect(result?.candidates.map(candidate => candidate.label) ?? [])
      .not.toContain(String.raw`\end{theorem}`);
  });

  it('recognizes packages provided by common AMS wrappers and classes', async () => {
    const mathtools = await complete(request(String.raw`\documentclass{article}
\usepackage{mathtools}
\begin{ali`));
    expect(mathtools?.candidates.map(candidate => candidate.label) ?? [])
      .toContain(String.raw`\begin{align}`);

    const amsClass = await complete(request(String.raw`\documentclass{amsart}
\begin{pro`));
    expect(amsClass?.candidates.map(candidate => candidate.label) ?? [])
      .toContain(String.raw`\begin{proof}`);
  });

  it('keeps AMS environment families behind their capability and context gates', async () => {
    const amsTopLevel = ['equation*', 'align', 'align*', 'gather'];
    const amsMathChildren = ['cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix'];

    for (const name of [...amsTopLevel, ...amsMathChildren]) {
      const bare = await complete(request(`\\begin{${name.slice(0, 3)}`));
      expect(bare?.candidates.map(candidate => candidate.label) ?? [])
        .not.toContain(`\\begin{${name}}`);
    }

    for (const name of amsTopLevel) {
      const loaded = await complete(request(`\\usepackage{amsmath}\n\\begin{${name.slice(0, 3)}`));
      expect(loaded?.candidates.map(candidate => candidate.label) ?? [])
        .toContain(`\\begin{${name}}`);
    }

    for (const name of amsMathChildren) {
      const loaded = await complete(request(`\\usepackage{amsmath}\n\\[\n\\begin{${name.slice(0, 3)}`));
      expect(loaded?.candidates.map(candidate => candidate.label) ?? [])
        .toContain(`\\begin{${name}}`);
    }
  });

  it('keeps the richer candidate when two providers share a label', async () => {
    // Regression: dedup keys on label alone so the cwl corpus (which knows an
    // environment exists but carries only its bare name) collapses into the
    // hand-written skeleton. That only works if the corpus ranks lower —
    // cwlProvider shipped at boost 2 against snippetProvider's 1, so the bare
    // stub won and inserting `\begin{itemize}` produced no `\item`.
    const stub = { label: String.raw`\begin{itemize}`, insertText: String.raw`\begin{itemize}`, boost: 0 };
    const skeleton = {
      label: String.raw`\begin{itemize}`,
      insertText: '\\begin{itemize}\n  \\item $1\n\\end{itemize}',
      boost: 1,
    };

    for (const providers of [
      [{ complete: () => [stub] }, { complete: () => [skeleton] }],
      // Order must not matter: highest boost wins either way.
      [{ complete: () => [skeleton] }, { complete: () => [stub] }],
    ]) {
      const result = await complete(request(String.raw`\begin{item`), providers);
      const matches = result?.candidates.filter(c => c.label === String.raw`\begin{itemize}`);
      expect(matches).toHaveLength(1);
      expect(matches?.[0].insertText).toContain(String.raw`\item`);
    }
  });

});
