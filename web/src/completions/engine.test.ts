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

});
