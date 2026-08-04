import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The provider reaches Rust through `ipc`, so the IPC layer is mocked. The
 * interesting assertions are about *which* packages get read: laziness is the
 * whole reason a 4465-file corpus is affordable on the keystroke path.
 */
const reads: string[] = [];
let corpus: Record<string, string> = {};

vi.mock('../api/tauri', () => ({
  ipc: {
    readCwl: (name: string) => {
      reads.push(name);
      return Promise.resolve(corpus[name] ?? null);
    },
    listCwlPackages: () => Promise.resolve(Object.keys(corpus)),
  },
}));

const { cwlProvider, resetCwlCacheForTests, prefetchCwlForDocument } = await import('./cwlProvider');
import type { CompletionRequest, CompletionSite } from './types';

function request(text: string, position = text.length): CompletionRequest {
  return { language: 'latex', text, position, explicit: false };
}

const COMMAND_SITE: CompletionSite = { kind: 'command', from: 0, to: 0, query: '\\' };
const BEGIN_SITE: CompletionSite = { kind: 'environment', from: 0, to: 0, query: '', action: 'begin' };

/**
 * Drive the provider until its background loads settle.
 *
 * `complete()` is deliberately synchronous — it serves what is cached and
 * triggers loading without awaiting — so a caller must poll to observe data
 * that has just arrived. The editor avoids this by prefetching on tab switch.
 */
async function completeSettled(text: string, site: CompletionSite = COMMAND_SITE) {
  let result = cwlProvider.complete(request(text), site);
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    result = cwlProvider.complete(request(text), site);
  }
  return await result;
}

beforeEach(() => {
  reads.length = 0;
  corpus = {};
  resetCwlCacheForTests();
});

describe('cwl provider loading', () => {
  it('always loads the LaTeX base package', async () => {
    corpus = { 'latex-document': '\\section{title}' };
    const out = await completeSettled('\\sec');
    expect(out.map(c => c.label)).toContain('\\section');
  });

  it('loads packages the document declares', async () => {
    corpus = {
      'latex-document': '\\section{title}',
      siunitx: '\\SI{value}{unit}',
    };
    const out = await completeSettled('\\usepackage{siunitx}\n\\SI');
    expect(out.map(c => c.label)).toContain('\\SI');
  });

  it('does not offer commands from packages the document has not loaded', async () => {
    corpus = {
      'latex-document': '\\section{title}',
      siunitx: '\\SI{value}{unit}',
    };
    const out = await completeSettled('\\sec');
    expect(out.map(c => c.label)).not.toContain('\\SI');
  });

  it('never reads a package the document does not reference', async () => {
    // The point of lazy loading: 4465 files exist, we touch a handful.
    corpus = {
      'latex-document': '\\section{title}',
      siunitx: '\\SI{value}{unit}',
      biblatex: '\\autocite{key}',
      babel: '\\selectlanguage{lang}',
    };
    await completeSettled('\\usepackage{siunitx}\n\\S');
    expect(reads.sort()).toEqual(['latex-document', 'siunitx']);
  });

  it('follows #include: dependencies transitively', async () => {
    corpus = {
      'latex-document': '',
      amsmath: '#include:amstext\n\\binom{a}{b}#m',
      amstext: '#include:amsgen\n\\text{words}',
      amsgen: '\\deepcommand',
    };
    const out = await completeSettled('\\usepackage{amsmath}\n\\de');
    expect(out.map(c => c.label)).toContain('\\deepcommand');
    expect(reads).toContain('amsgen');
  });

  it('maps \\documentclass to its class- package', async () => {
    corpus = {
      'latex-document': '',
      'class-beamer': '\\frame{content}',
    };
    const out = await completeSettled('\\documentclass{beamer}\n\\fra');
    expect(out.map(c => c.label)).toContain('\\frame');
  });

  it('reads a package only once across many keystrokes', async () => {
    corpus = { 'latex-document': '\\section{title}' };
    await completeSettled('\\s');
    await completeSettled('\\se');
    await completeSettled('\\sec');
    expect(reads.filter(n => n === 'latex-document')).toHaveLength(1);
  });

  it('ignores packages inside comments', async () => {
    corpus = {
      'latex-document': '',
      siunitx: '\\SI{value}{unit}',
    };
    await completeSettled('% \\usepackage{siunitx}\n\\S');
    expect(reads).not.toContain('siunitx');
  });

  it('handles multiple packages in one \\usepackage', async () => {
    corpus = {
      'latex-document': '',
      graphicx: '\\includegraphics[opts]{file}',
      xcolor: '\\textcolor{name}{text}',
    };
    await completeSettled('\\usepackage{graphicx, xcolor}\n\\t');
    expect(reads.sort()).toEqual(['graphicx', 'latex-document', 'xcolor']);
  });

  it('does not retry a package that has no cwl', async () => {
    corpus = { 'latex-document': '' };
    await completeSettled('\\usepackage{nonexistentpkg}\n\\s');
    await completeSettled('\\usepackage{nonexistentpkg}\n\\se');
    // Known-absent names are filtered by the availability list, so the read
    // should not even be attempted.
    expect(reads.filter(n => n === 'nonexistentpkg').length).toBeLessThanOrEqual(1);
  });

  it('prefetches a document\'s packages before any keystroke', async () => {
    corpus = {
      'latex-document': '\\section{title}',
      siunitx: '\\SI{value}{unit}',
    };
    // The editor prefetches the document as opened, then the user types into it,
    // so the completion text must be the same document plus the partial command.
    const opened = '\\usepackage{siunitx}\n';
    prefetchCwlForDocument(opened);
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    // The very first completion already sees the corpus, and typing triggers no
    // further read.
    const before = reads.length;
    const out = await cwlProvider.complete(request(`${opened}\\SI`), COMMAND_SITE);
    expect(out.map(c => c.label)).toContain('\\SI');
    expect(reads.length).toBe(before);
  });
});

describe('cwl provider candidates', () => {
  it('emits cm6 snippet syntax so spaced argument names survive', async () => {
    corpus = { 'latex-document': '\\section[short title]{title}' };
    const out = await completeSettled('\\sec');
    const section = out.find(c => c.label === '\\section')!;
    expect(section.snippetSyntax).toBe('cm6');
    expect(section.insertText).toBe('\\section[${1:short title}]{${2:title}}');
    expect(section.snippet).toBe(true);
  });

  it('marks argument-less commands as non-snippets', async () => {
    corpus = { 'latex-document': '\\maketitle' };
    const out = await completeSettled('\\mak');
    expect(out.find(c => c.label === '\\maketitle')!.snippet).toBe(false);
  });

  it('attributes each candidate to its source package', async () => {
    corpus = {
      'latex-document': '',
      siunitx: '\\SI{value}{unit}',
    };
    const out = await completeSettled('\\usepackage{siunitx}\n\\SI');
    expect(out.find(c => c.label === '\\SI')!.detail).toBe('siunitx');
  });

  it('downranks #* unusual commands below normal ones', async () => {
    corpus = { 'latex-document': '\\normalcmd\n\\weirdcmd#*' };
    const out = await completeSettled('\\c');
    const normal = out.find(c => c.label === '\\normalcmd')!;
    const weird = out.find(c => c.label === '\\weirdcmd')!;
    expect(weird.boost!).toBeLessThan(normal.boost!);
  });

  it('offers environments for \\begin but leaves \\end to the semantic provider', async () => {
    corpus = { 'latex-document': '\\begin{center}' };
    const begun = await completeSettled('\\begin{cen', BEGIN_SITE);
    expect(begun.map(c => c.label)).toContain('\\begin{center}');

    const ended = await cwlProvider.complete(
      request('\\end{cen'),
      { kind: 'environment', from: 0, to: 0, query: '', action: 'end' },
    );
    expect(ended).toEqual([]);
  });

  it('stays out of citation, reference and file sites', async () => {
    corpus = { 'latex-document': '\\section{title}' };
    for (const site of [
      { kind: 'citation', from: 0, to: 0, query: '' },
      { kind: 'reference', from: 0, to: 0, query: '' },
      { kind: 'file', from: 0, to: 0, query: '', command: 'input' },
    ] as CompletionSite[]) {
      expect(await cwlProvider.complete(request('\\cite{'), site)).toEqual([]);
    }
  });

  it('returns nothing for non-LaTeX documents', async () => {
    corpus = { 'latex-document': '\\section{title}' };
    const out = await cwlProvider.complete(
      { language: 'markdown', text: '\\sec', position: 4, explicit: false },
      COMMAND_SITE,
    );
    expect(out).toEqual([]);
  });
});
