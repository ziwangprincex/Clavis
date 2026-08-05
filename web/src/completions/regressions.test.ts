// Regression tests for logic bugs that the original completion audit missed.
//
// Every case here failed before the fix. The theme is that the earlier tests
// used idealized fixtures (forward-slash paths, single-line arguments) which
// happened to avoid the real runtime shapes.

import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { snippet } from '@codemirror/autocomplete';
import { detectCompletionSite } from './context';
import { complete } from './engine';
import { snippetToCM6, snippetsForLang } from './snippets';
import type { CompletionProvider, CompletionRequest, CompletionWorkspace } from './types';

function request(text: string, workspace?: CompletionWorkspace, position = text.length): CompletionRequest {
  return { language: 'latex', text, position, explicit: false, workspace };
}

/**
 * Run CodeMirror's real `snippet()` apply function and return the inserted text.
 * `snippet()` only needs `{state, dispatch}`, so no DOM is required — and using
 * the real implementation is the whole point: the previous escape bug was
 * invisible to any test that only inspected our own converter's output.
 */
function insertedText(template: string): string {
  const state = EditorState.create({ doc: '' });
  let inserted = '';
  const view = {
    state,
    dispatch: (transaction: { state: EditorState }) => {
      inserted = transaction.state.doc.toString();
    },
  };
  snippet(snippetToCM6(template))(view as never, null as never, 0, 0);
  return inserted;
}

describe('Windows canonical paths from the Rust project collector', () => {
  // collect_project_files returns std::fs::canonicalize output, which on Windows
  // is a "\\?\C:\..." verbatim path, while rootPath comes from tab.filePath as a
  // plain "C:\...". These must still compare equal.
  const workspace: CompletionWorkspace = {
    rootPath: 'C:\\paper\\main.tex',
    activePath: 'C:\\paper\\main.tex',
    documents: [
      { path: 'C:\\paper\\main.tex', language: 'latex', text: '' },
      { path: '\\\\?\\C:\\paper\\chapters\\intro.tex', language: 'latex', text: String.raw`\label{sec:intro}` },
      { path: '\\\\?\\C:\\paper\\refs.bib', language: 'latex', text: '@book{knuth1984, title={T}}' },
    ],
  };

  it('offers files that were never opened as a tab', async () => {
    const result = await complete(request(String.raw`\input{`, workspace));

    expect(result?.candidates.map(candidate => candidate.label)).toContain('chapters/intro');
  });

  it('offers labels from verbatim-path project documents', async () => {
    const result = await complete(request(String.raw`\ref{`, workspace));

    expect(result?.candidates.map(candidate => candidate.label)).toContain('sec:intro');
  });

  it('offers citation keys from verbatim-path BibTeX documents', async () => {
    const result = await complete(request(String.raw`\cite{`, workspace));

    expect(result?.candidates.map(candidate => candidate.label)).toContain('knuth1984');
  });

  it('preserves on-disk casing in the inserted path', async () => {
    const cased: CompletionWorkspace = {
      rootPath: 'C:\\Paper\\Main.tex',
      activePath: 'C:\\Paper\\Main.tex',
      documents: [
        { path: 'C:\\Paper\\Main.tex', language: 'latex', text: '' },
        { path: '\\\\?\\C:\\Paper\\Chapters\\Methods.tex', language: 'latex', text: '' },
      ],
    };
    const result = await complete(request(String.raw`\input{`, cased));

    expect(result?.candidates.map(candidate => candidate.label)).toContain('Chapters/Methods');
  });
});

describe('no-Project scoping covers file candidates too', () => {
  it('does not offer files from unrelated open tabs', async () => {
    const loose: CompletionWorkspace = {
      rootPath: null,
      activePath: 'C:\\work\\thesis.tex',
      documents: [
        { path: 'C:\\work\\thesis.tex', language: 'latex', text: '' },
        { path: 'D:\\unrelated\\other.tex', language: 'latex', text: '' },
      ],
    };
    const result = await complete(request(String.raw`\input{`, loose));

    expect(result?.candidates.map(candidate => candidate.label) ?? []).not.toContain('other');
  });
});

describe('environment names containing digits and underscores', () => {
  it('treats align2 as an environment, not a bare word', () => {
    expect(detectCompletionSite(request(String.raw`\begin{align2`))).toEqual(
      expect.objectContaining({ kind: 'environment', query: 'align2' }),
    );
  });

  it('treats my_env as an environment', () => {
    expect(detectCompletionSite(request(String.raw`\begin{my_env`))).toEqual(
      expect.objectContaining({ kind: 'environment', query: 'my_env' }),
    );
  });

  it('completes a project environment whose name ends in a digit', async () => {
    // The declaration lives in a sibling file: `documents()` intentionally
    // replaces the active document's snapshot with the live buffer, so a
    // declaration stored only in the stale snapshot of the file being typed is
    // correctly absent.
    const workspace: CompletionWorkspace = {
      rootPath: 'C:/paper/main.tex',
      activePath: 'C:/paper/main.tex',
      documents: [
        { path: 'C:/paper/main.tex', language: 'latex', text: '' },
        { path: 'C:/paper/defs.tex', language: 'latex', text: String.raw`\newenvironment{note2}{}{}` },
      ],
    };
    const result = await complete(request(String.raw`\begin{note`, workspace));

    expect(result?.candidates.map(candidate => candidate.label)).toContain(String.raw`\begin{note2}`);
  });
});

describe('arguments wrapped across lines', () => {
  it('queries only the last key of a wrapped citation list', () => {
    const text = '\\cite{knuth1984,\nlam';

    expect(detectCompletionSite(request(text))).toEqual(
      expect.objectContaining({ kind: 'citation', query: 'lam' }),
    );
  });

  it('handles a wrapped and indented citation list', () => {
    const text = '\\cite{knuth1984,\n      lam';

    expect(detectCompletionSite(request(text))).toEqual(
      expect.objectContaining({ kind: 'citation', query: 'lam' }),
    );
  });

  it('queries only the last line of a reference on its own line', () => {
    expect(detectCompletionSite(request('\\ref{\nsec'))).toEqual(
      expect.objectContaining({ kind: 'reference', query: 'sec' }),
    );
  });

  it('recognizes a citation after a nested optional argument', () => {
    expect(detectCompletionSite(request(String.raw`\cite[p. [3]]{k`))).toEqual(
      expect.objectContaining({ kind: 'citation', query: 'k' }),
    );
  });

  it('handles CRLF line endings, which this repo checks out on Windows', () => {
    expect(detectCompletionSite(request('\\cite{knuth1984,\r\nlam'))).toEqual(
      expect.objectContaining({ kind: 'citation', query: 'lam' }),
    );
  });

  it('splits a wrapped file list on the line break but not on spaces', () => {
    expect(detectCompletionSite(request('\\includegraphics{a.png,\r\nMy Img/b'))).toEqual(
      expect.objectContaining({ kind: 'file', query: 'My Img/b' }),
    );
  });

  it('is not derailed by an unclosed brace earlier in the document', () => {
    const text = '\\section{Title\n\nSome prose here.\n\n\\ref{sec';

    expect(detectCompletionSite(request(text))).toEqual(
      expect.objectContaining({ kind: 'reference', query: 'sec' }),
    );
  });

  it('still replaces a whole file path containing spaces', () => {
    const text = String.raw`\includegraphics{My Images/cha`;

    expect(detectCompletionSite(request(text))).toEqual(expect.objectContaining({
      kind: 'file',
      from: String.raw`\includegraphics{`.length,
      query: 'My Images/cha',
    }));
  });
});

describe('literal dollars survive CodeMirror snippet insertion', () => {
  // CodeMirror's Snippet.parse unescapes only \{ and \}, never \$, so the old
  // "\\$" escape leaked a backslash into the document.
  it('inserts inline math delimiters verbatim', () => {
    expect(insertedText('$$1E=mc^2$')).toBe('$E=mc^2$');
  });

  it('inserts a math block fence verbatim', () => {
    expect(insertedText('$$\n$1\n$$\n')).toBe('$$\n\n$$\n');
  });

  it('leaves no stray backslash in any built-in snippet', () => {
    const offenders: string[] = [];
    for (const language of ['latex', 'typst', 'markdown'] as const) {
      for (const entry of snippetsForLang(language)) {
        if (insertedText(entry.t).includes('\\$')) offenders.push(`${language}: ${entry.l}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps a literal dollar-brace out of CodeMirror field syntax', () => {
    expect(insertedText('cost: ${amount}')).toBe('cost: ${amount}');
  });

  it('keeps a real field working alongside a literal dollar-brace', () => {
    expect(insertedText('cost: ${amount} for $1item')).toBe('cost: ${amount} for item');
  });

  it('still converts numbered fields with numeric defaults', () => {
    expect(snippetToCM6(String.raw`\includegraphics[width=$10.8\linewidth]{$2path}`))
      .toBe('\\includegraphics[width=${1:0.8}\\linewidth]{${2:path}}');
  });
});

describe('open-environment ranking is computed once per request', () => {
  it('still ranks the nearest open environment first', async () => {
    const text = String.raw`\begin{document}
\begin{itemize}
\end{`;
    const result = await complete(request(text));

    expect(result?.candidates[0]?.label).toBe(String.raw`\end{itemize}`);
  });
});

describe('argument-site detection for package/class/keyval', () => {
  it('detects a package argument inside \\usepackage braces', () => {
    expect(detectCompletionSite(request(String.raw`\usepackage[utf8]{in`))).toEqual({
      kind: 'package',
      from: 18,
      to: 20,
      query: 'in',
    });
  });

  it('detects a document class argument', () => {
    expect(detectCompletionSite(request(String.raw`\documentclass{be`))).toEqual({
      kind: 'class',
      from: 15,
      to: 17,
      query: 'be',
    });
  });

  it('detects a keyval site inside open optional brackets', () => {
    expect(detectCompletionSite(request(String.raw`\includegraphics[wi`))).toEqual({
      kind: 'keyval',
      from: 17,
      to: 19,
      query: 'wi',
      command: '\\includegraphics',
    });
  });

  it('detects a keyval site on an environment', () => {
    expect(detectCompletionSite(request(String.raw`\begin{Form}[t`))).toEqual({
      kind: 'keyval',
      from: 13,
      to: 14,
      query: 't',
      command: '\\begin{Form}',
    });
  });

  it('does not misdetect a closed optional argument as keyval', () => {
    expect(detectCompletionSite(request(String.raw`\cite[p. 3]{k`))).toEqual(
      expect.objectContaining({ kind: 'citation' }),
    );
  });

  it('does not misdetect display-math brackets as keyval', () => {
    // `\[` is a single punctuation command, not a name, so it must not match
    // the keyval pattern — and nothing else applies at this position either.
    expect(detectCompletionSite(request(String.raw`\[a^2 +`))).toBeNull();
  });
});

describe('an unclosed [ must not swallow completion', () => {
  // The keyval site is checked before every other LaTeX site, and no provider
  // answers a keyval site it has no keys for. So a false positive did not merely
  // add noise: `complete()` returned null and the popup never opened. The worst
  // case was `\left[ ... \right]`, which is ordinary maths — completion was dead
  // for the whole span until the closing `\right]` was typed.

  it('treats \\left[ followed by a command as a command site', () => {
    expect(detectCompletionSite(request(String.raw`\left[ \fra`))).toEqual(
      expect.objectContaining({ kind: 'command', query: String.raw`\fra` }),
    );
  });

  it('still completes commands while typing inside \\left[', async () => {
    const result = await complete(request(String.raw`\left[ \fra`));

    expect(result?.candidates.length ?? 0).toBeGreaterThan(0);
  });

  it('treats \\left[ followed by prose as a word site', () => {
    expect(detectCompletionSite(request(String.raw`\left[ x + alp`))).toEqual(
      expect.objectContaining({ kind: 'word', query: 'alp' }),
    );
  });

  it('does not let an unclosed bracket reach across a line break', () => {
    // `[^[\]\r\n]*` bounds the bracket body to one line, so the `\alp` on the
    // next line is a plain command site rather than a 30-character keyval query.
    const text = '\\item[foo\nprose continues \\alp';

    expect(detectCompletionSite(request(text))).toEqual(
      expect.objectContaining({ kind: 'command', query: String.raw`\alp` }),
    );
  });

  it('falls back to the command site when a keyval site yields nothing', async () => {
    // `\item[Ter` is shaped exactly like a real option list, so the regex cannot
    // reject it — `\item` simply has no `#keyvals:` anywhere in the corpus. This
    // is the case the engine's retry exists for, and the only one that proves it.
    expect(detectCompletionSite(request(String.raw`\item[Ter`))).toEqual(
      expect.objectContaining({ kind: 'keyval', command: String.raw`\item` }),
    );

    const result = await complete(request(String.raw`\item[Ter\tex`));

    expect(result?.candidates.length ?? 0).toBeGreaterThan(0);
  });

  it('retries with the keyval site suppressed, and only then', async () => {
    // Asserting on the sites the engine actually asks providers about, so the
    // retry is proven to happen rather than inferred from a non-empty list.
    const seen: string[] = [];
    const spy: CompletionProvider = {
      complete(_request, site) {
        seen.push(site.kind);
        // Answer nothing at a keyval site (as every real provider does for a
        // command with no `#keyvals:`), one candidate everywhere else.
        return site.kind === 'keyval'
          ? []
          : [{ label: 'stub', insertText: 'stub' }];
      },
    };

    const retried = await complete(request(String.raw`\item[Ter`), [spy]);

    // `Ter` is a bare word, so the retry lands on the word site — the point is
    // that a second pass happened at all, not which site it picked.
    expect(seen).toEqual(['keyval', 'word']);
    expect(retried?.candidates).toHaveLength(1);

    // A keyval site that does answer must not trigger a second pass.
    seen.length = 0;
    const answered: CompletionProvider = {
      complete(_request, site) {
        seen.push(site.kind);
        return [{ label: 'draft', insertText: 'draft' }];
      },
    };
    await complete(request(String.raw`\includegraphics[dr`), [answered]);

    expect(seen).toEqual(['keyval']);
  });

  it('keeps the query to the segment after the last comma', () => {
    // The query used to be the entire bracket body, so a second option never
    // matched anything: `width=5cm,he` was looked up verbatim.
    expect(detectCompletionSite(request(String.raw`\includegraphics[width=5cm,he`))).toEqual(
      expect.objectContaining({ kind: 'keyval', query: 'he' }),
    );
  });

  it('does not treat an option value as a key', () => {
    // Typing a value (`width=.5\textwidth`) is not a key position; falling
    // through is what lets `\textwidth` complete there.
    expect(detectCompletionSite(request(String.raw`\includegraphics[width=.5\textw`))).toEqual(
      expect.objectContaining({ kind: 'command' }),
    );
  });
});
