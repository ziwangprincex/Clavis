import { describe, expect, it } from 'vitest';
import { detectCompletionSite } from './context';
import { snippetToCM6 } from './snippets';
import { complete } from './engine';
import type { CompletionRequest, CompletionWorkspace } from './types';

function request(text: string, position = text.length, workspace?: CompletionWorkspace): CompletionRequest {
  return { language: 'latex', text, position, explicit: false, workspace };
}

const workspace: CompletionWorkspace = {
  rootPath: 'C:/paper/main.tex',
  activePath: 'C:/paper/main.tex',
  documents: [
    { path: 'C:/paper/main.tex', language: 'latex', text: '' },
    { path: 'C:/paper/chapters/intro.tex', language: 'latex', text: '' },
    { path: 'C:/paper/images/chart.pdf', language: 'markdown', text: '' },
    { path: 'C:/paper/refs.bib', language: 'latex', text: '@book{key, title={T}}' },
    { path: 'C:/other/unrelated.tex', language: 'latex', text: '' },
  ],
};

describe('completion logic audit', () => {
  it('consumes an auto-closed brace when replacing an environment prefix', async () => {
    const text = String.raw`\begin{doc}`;
    const result = await complete(request(text, text.length - 1, workspace));

    expect(result?.to).toBe(text.length);
  });

  it('filters project files by the receiving command', async () => {
    const input = await complete(request(String.raw`\input{`, undefined, workspace));
    const image = await complete(request(String.raw`\includegraphics{`, undefined, workspace));

    expect(input?.candidates.map(candidate => candidate.label)).toContain('chapters/intro');
    expect(input?.candidates.map(candidate => candidate.label)).not.toContain('images/chart.pdf');
    expect(image?.candidates.map(candidate => candidate.label)).toContain('images/chart.pdf');
    expect(image?.candidates.map(candidate => candidate.label)).not.toContain('chapters/intro.tex');
  });

  it('does not offer files outside the active project root', async () => {
    const result = await complete(request(String.raw`\input{`, undefined, workspace));

    expect(result?.candidates.map(candidate => candidate.label)).not.toContain('unrelated');
  });

  it('uses the right BibTeX extension convention for each command', async () => {
    const legacy = await complete(request(String.raw`\bibliography{`, undefined, workspace));
    const biblatex = await complete(request(String.raw`\addbibresource{`, undefined, workspace));

    expect(legacy?.candidates.map(candidate => candidate.label)).toContain('refs');
    expect(biblatex?.candidates.map(candidate => candidate.label)).toContain('refs.bib');
  });

  it('recognizes citation arguments after two optional arguments', () => {
    const text = String.raw`\cite[see][p. 3]{ke`;

    expect(detectCompletionSite(request(text))).toEqual(expect.objectContaining({
      kind: 'citation',
      query: 'ke',
    }));
  });

  it('parses legacy single-digit placeholders without swallowing numeric defaults', () => {
    expect(snippetToCM6(String.raw`\includegraphics[width=$10.8\linewidth]{$2path}`))
      .toBe('\\includegraphics[width=${1:0.8}\\linewidth]{${2:path}}');
    expect(snippetToCM6('date: $32026-01-01')).toBe('date: ${3:2026-01-01}');
  });

  it('keeps local providers alive when an async provider fails', async () => {
    const result = await complete(request(String.raw`\sec`), [
      { async complete() { throw new Error('language server unavailable'); } },
      { complete() { return [{ label: String.raw`\section`, insertText: String.raw`\section{$1}` }]; } },
    ]);

    expect(result?.candidates).toContainEqual(expect.objectContaining({ label: String.raw`\section` }));
  });

  it('does not index labels and environments that are commented out', async () => {
    const commented: CompletionWorkspace = {
      rootPath: 'C:/paper/main.tex',
      activePath: 'C:/paper/main.tex',
      documents: [
        { path: 'C:/paper/main.tex', language: 'latex', text: '' },
        {
          path: 'C:/paper/chapter.tex',
          language: 'latex',
          text: String.raw`% \label{ghost}
% \newenvironment{ghostenv}{}{}`,
        },
      ],
    };
    const references = await complete(request(String.raw`\ref{gh`, undefined, commented));
    const environments = await complete(request(String.raw`\begin{gh`, undefined, commented));

    expect(references).toBeNull();
    expect(environments?.candidates.map(candidate => candidate.label)).not.toContain(String.raw`\begin{ghostenv}`);
  });

  it('preserves path casing in displayed Windows file candidates', async () => {
    const cased: CompletionWorkspace = {
      rootPath: 'C:/Paper/Main.tex',
      activePath: 'C:/Paper/Main.tex',
      documents: [
        { path: 'C:/Paper/Main.tex', language: 'latex', text: '' },
        { path: 'C:/Paper/Chapters/Methods.tex', language: 'latex', text: '' },
      ],
    };
    const result = await complete(request(String.raw`\input{`, undefined, cased));

    expect(result?.candidates.map(candidate => candidate.label)).toContain('Chapters/Methods');
  });


  it('ignores commented environment commands when ranking end completions', async () => {
    const text = String.raw`% \begin{ghost}
\begin{document}
\end{`;
    const result = await complete(request(text));

    expect(result?.candidates[0]?.label).toBe(String.raw`\end{document}`);
    expect(result?.candidates.map(candidate => candidate.label)).not.toContain(String.raw`\end{ghost}`);
  });


  it('keeps no-project semantic completion scoped to the active document', async () => {
    const loose: CompletionWorkspace = {
      rootPath: null,
      activePath: 'C:/one.tex',
      documents: [
        { path: 'C:/one.tex', language: 'latex', text: String.raw`\label{one}` },
        { path: 'C:/two.tex', language: 'latex', text: String.raw`\label{two}` },
      ],
    };
    const result = await complete(request(String.raw`\label{fresh}\n\ref{`, undefined, loose));

    expect(result?.candidates.map(candidate => candidate.label)).toEqual(
      expect.arrayContaining(['fresh']),
    );
    expect(result?.candidates.map(candidate => candidate.label)).not.toContain('two');
  });

  it('replaces the full file argument when its path contains spaces', () => {
    const text = String.raw`\includegraphics{My Images/cha`;

    expect(detectCompletionSite(request(text))).toEqual(expect.objectContaining({
      kind: 'file',
      from: String.raw`\includegraphics{`.length,
      query: 'My Images/cha',
    }));
  });

});
