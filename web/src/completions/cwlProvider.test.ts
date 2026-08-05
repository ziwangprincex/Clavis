import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The provider reaches Rust through `ipc`, so the IPC layer is mocked. The
 * interesting assertions are about *which* packages get read: laziness is the
 * whole reason a 4465-file corpus is affordable on the keystroke path.
 */
const reads: string[] = [];
let corpus: Record<string, string> = {};
/** When set, the mocked ipc throws synchronously, as it does outside the shell. */
let tauriMissing = false;

vi.mock('../api/tauri', () => ({
  hasTauri: () => !tauriMissing,
  ipc: {
    readCwl: (name: string) => {
      if (tauriMissing) throw new Error('Tauri runtime not available (running outside the app shell?)');
      reads.push(name);
      return Promise.resolve(corpus[name] ?? null);
    },
    listCwlPackages: () => {
      if (tauriMissing) throw new Error('Tauri runtime not available (running outside the app shell?)');
      return Promise.resolve(Object.keys(corpus));
    },
  },
}));

const { cwlProvider, resetCwlCacheForTests, prefetchCwlForDocument, setCwlOptions } = await import('./cwlProvider');
const { ipc } = await import('../api/tauri');
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
  tauriMissing = false;
  resetCwlCacheForTests();
});

describe('cwl provider outside the app shell', () => {
  // Regression: `ipc` throws synchronously rather than rejecting, so `.catch()`
  // never saw it. The throw escaped `prefetchCwlForDocument` inside a React
  // effect and black-screened the editor with "Tauri runtime not available".
  // api/tauri.ts documents that callers must guard with `hasTauri()`.
  it('does not throw from prefetch', () => {
    tauriMissing = true;
    expect(() => prefetchCwlForDocument('\\usepackage{siunitx}\n')).not.toThrow();
  });

  it('does not throw from complete, and yields no candidates', async () => {
    tauriMissing = true;
    let out;
    expect(() => { out = cwlProvider.complete(request('\\sec'), COMMAND_SITE); }).not.toThrow();
    expect(await out).toEqual([]);
  });

  it('never calls ipc without a runtime', () => {
    // The try/catch in prefetch would swallow a throw and make the tests above
    // pass even with the hasTauri() guards removed. Asserting that ipc is not
    // reached at all is what actually pins the guards in place.
    tauriMissing = true;
    let called = false;
    const spy = vi.spyOn(ipc, 'listCwlPackages').mockImplementation(() => {
      called = true;
      throw new Error('should not be reached');
    });
    const readSpy = vi.spyOn(ipc, 'readCwl').mockImplementation(() => {
      called = true;
      throw new Error('should not be reached');
    });
    prefetchCwlForDocument('\\usepackage{siunitx}\n');
    cwlProvider.complete(request('\\sec'), COMMAND_SITE);
    expect(called).toBe(false);
    spy.mockRestore();
    readSpy.mockRestore();
  });

  it('recovers once the runtime is available', async () => {
    tauriMissing = true;
    prefetchCwlForDocument('\\documentclass{article}\n');
    tauriMissing = false;
    resetCwlCacheForTests();
    corpus = { 'latex-document': '\\section{title}' };
    const out = await completeSettled('\\sec');
    expect(out.map(c => c.label)).toContain('\\section');
  });
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

  it('does not leak one document\'s packages into another', async () => {
    // The package-scan memo and the parsed-package cache are module singletons
    // shared by every tab. The cache is fine to share (a .cwl file means the
    // same thing everywhere), but the *active set* must follow the document.
    corpus = {
      'latex-document': '\\section{title}',
      siunitx: '\\SI{value}{unit}',
      tikz: '\\tikzset{opts}',
    };
    const docA = '\\usepackage{siunitx}\n';
    const docB = '\\usepackage{tikz}\n';

    const a1 = await completeSettled(`${docA}\\S`);
    expect(a1.map(c => c.label)).toContain('\\SI');

    const b = await completeSettled(`${docB}\\t`);
    expect(b.map(c => c.label)).toContain('\\tikzset');
    expect(b.map(c => c.label), 'siunitx must not leak into doc B').not.toContain('\\SI');

    // Switching back must not serve doc B's set either.
    const a2 = await completeSettled(`${docA}\\S`);
    expect(a2.map(c => c.label)).toContain('\\SI');
    expect(a2.map(c => c.label), 'tikz must not leak back into doc A').not.toContain('\\tikzset');
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

describe('cwl provider context filtering', () => {
  /** A corpus exercising each classifier that gates visibility. */
  const CLASSIFIED = [
    '\\sqrt{arg}#m',          // math only
    '\\textbf{text}#n',       // text only
    '\\multicolumn{n}{c}{t}#t', // tabular only
    '\\State#/algorithmic',   // specific environment only
    '\\anywhere',             // unclassified
  ].join('\n');

  it('offers math-only commands inside $...$ and hides them in prose', async () => {
    corpus = { 'latex-document': CLASSIFIED };
    const inMath = await completeSettled('Let $\\sq');
    expect(inMath.map(c => c.label)).toContain('\\sqrt');

    const inProse = await completeSettled('Prose \\sq');
    expect(inProse.map(c => c.label)).not.toContain('\\sqrt');
  });

  it('hides text-only commands inside math', async () => {
    corpus = { 'latex-document': CLASSIFIED };
    const inMath = await completeSettled('Let $\\tex');
    expect(inMath.map(c => c.label)).not.toContain('\\textbf');

    const inProse = await completeSettled('Prose \\tex');
    expect(inProse.map(c => c.label)).toContain('\\textbf');
  });

  it('applies math filtering inside display environments too', async () => {
    corpus = { 'latex-document': CLASSIFIED };
    const out = await completeSettled('\\begin{align}\n  \\sq');
    expect(out.map(c => c.label)).toContain('\\sqrt');
  });

  it('restricts tabular-only commands to tabular-like environments', async () => {
    corpus = { 'latex-document': CLASSIFIED };
    const inTabular = await completeSettled('\\begin{tabular}{cc}\n\\multi');
    expect(inTabular.map(c => c.label)).toContain('\\multicolumn');

    const inProse = await completeSettled('Prose \\multi');
    expect(inProse.map(c => c.label)).not.toContain('\\multicolumn');
  });

  it('restricts /env commands to their declared environment', async () => {
    corpus = { 'latex-document': CLASSIFIED };
    const inEnv = await completeSettled('\\begin{algorithmic}\n\\Sta');
    expect(inEnv.map(c => c.label)).toContain('\\State');

    const outside = await completeSettled('\\begin{itemize}\n\\Sta');
    expect(outside.map(c => c.label)).not.toContain('\\State');
  });

  it('offers unclassified commands everywhere', async () => {
    corpus = { 'latex-document': CLASSIFIED };
    for (const text of ['Prose \\any', 'Math $\\any', '\\begin{tabular}{c}\n\\any']) {
      const out = await completeSettled(text);
      expect(out.map(c => c.label), text).toContain('\\anywhere');
    }
  });

  it('treats an escaped dollar as text, not math', async () => {
    // `costs \$5` must not flip the rest of the line into math mode.
    corpus = { 'latex-document': CLASSIFIED };
    const out = await completeSettled('costs \\$5 so \\tex');
    expect(out.map(c => c.label)).toContain('\\textbf');
  });
});

describe('cwl provider options', () => {
  const CLASSIFIED = '\\sqrt{arg}#m\n\\normalcmd\n\\weirdcmd#*';

  afterEach(() => {
    setCwlOptions({ enabled: true, showUnusual: false, respectContext: true });
  });

  it('yields nothing when disabled', async () => {
    corpus = { 'latex-document': CLASSIFIED };
    setCwlOptions({ enabled: false });
    expect(await completeSettled('\\nor')).toEqual([]);
  });

  it('skips context filtering when respectContext is off', async () => {
    corpus = { 'latex-document': CLASSIFIED };
    setCwlOptions({ respectContext: false });
    // `\sqrt` is math-only, so this is prose where it would normally be hidden.
    const out = await completeSettled('Prose \\sq');
    expect(out.map(c => c.label)).toContain('\\sqrt');
  });

  it('still offers #* commands by default, just ranked last', async () => {
    // `#*` is a quarter of the corpus and includes real commands like
    // \addcontentsline, so it must never be hidden outright.
    corpus = { 'latex-document': CLASSIFIED };
    const out = await completeSettled('\\w');
    const weird = out.find(c => c.label === '\\weirdcmd');
    expect(weird).toBeDefined();
    expect(weird!.boost!).toBeLessThan(out.find(c => c.label === '\\normalcmd')!.boost!);
  });

  it('promotes #* commands to normal rank when showUnusual is on', async () => {
    corpus = { 'latex-document': CLASSIFIED };
    setCwlOptions({ showUnusual: true });
    const out = await completeSettled('\\w');
    expect(out.find(c => c.label === '\\weirdcmd')!.boost)
      .toBe(out.find(c => c.label === '\\normalcmd')!.boost);
  });
});

describe('cwl provider argument sites', () => {
  it('inserts \\usepackage without option placeholders', async () => {
    // The corpus carries both forms; whichever the merge keeps, the inserted
    // text must be the bare command with an empty argument so the package
    // completion takes over inside the braces.
    corpus = {
      'latex-document': '\\usepackage[options%keyvals]{package}\n\\usepackage{package}',
    };
    const out = await completeSettled('\\us');
    const usepackage = out.find(c => c.label === '\\usepackage');
    expect(usepackage?.insertText).toBe('\\usepackage{${1}}');
  });

  it('inserts \\documentclass without option placeholders', async () => {
    corpus = { 'latex-document': '\\documentclass[keyvals]{class}\n\\documentclass{class}' };
    const out = await completeSettled('\\doc');
    const dc = out.find(c => c.label === '\\documentclass');
    expect(dc?.insertText).toBe('\\documentclass{${1}}');
  });

  it('offers package names from the corpus index, excluding classes', async () => {
    corpus = {
      'latex-document': '',
      amsmath: '\\align',
      geometry: '\\geometry',
      beamer: '\\frame',
      'class-article': '',
    };
    const site: CompletionSite = { kind: 'package', from: 0, to: 0, query: 'am' };
    const out = await completeSettled('\\usepackage{am', site);
    expect(out.map(c => c.label)).toEqual(['amsmath']);
  });

  it('boosts common packages to the top of the package list', async () => {
    corpus = {
      'latex-document': '',
      amsmath: '',
      amssymb: '',
      a4wide: '',
      amsfonts: '',
    };
    const site: CompletionSite = { kind: 'package', from: 0, to: 0, query: 'a' };
    const out = await completeSettled('\\usepackage{a', site);
    const labels = out.map(c => c.label);
    expect(labels.indexOf('amsmath')).toBeLessThan(labels.indexOf('a4wide'));
  });

  it('offers document classes from class-*.cwl stems', async () => {
    corpus = {
      'latex-document': '',
      'class-beamer': '',
      'class-ctexart': '',
    };
    const site: CompletionSite = { kind: 'class', from: 0, to: 0, query: 'be' };
    const out = await completeSettled('\\documentclass{be', site);
    expect(out.map(c => c.label)).toEqual(['beamer']);
  });

  it('always offers the TeX kernel classes even without a cwl file (article)', async () => {
    // article has no class-*.cwl upstream (its commands live in
    // latex-document.cwl), but every TeX distribution ships it.
    corpus = { 'latex-document': '' };
    const site: CompletionSite = { kind: 'class', from: 0, to: 0, query: 'ar' };
    const out = await completeSettled('\\documentclass{ar', site);
    expect(out.map(c => c.label)).toEqual(['article']);
  });

  it('offers keyvals options only for loaded packages', async () => {
    corpus = {
      'latex-document': '',
      graphics: '#keyvals:\\usepackage/graphics#c\ndraft\nfinal\nhiresbb\n#endkeyvals\n\\includegraphics{file}',
    };
    const site: CompletionSite = { kind: 'keyval', from: 0, to: 0, query: 'd', command: '\\usepackage' };
    const out = await completeSettled('\\usepackage{graphics}\n\\usepackage[d', site);
    expect(out.map(c => c.label)).toEqual(['draft']);
  });

  it('offers keyvals options for environments', async () => {
    corpus = {
      'latex-document': '',
      hyperref: '#keyvals:\\begin{Form},\\includegraphics#c\nSubmitName\nSubmitAction\n#endkeyvals',
    };
    const site: CompletionSite = { kind: 'keyval', from: 0, to: 0, query: 'Sub', command: '\\begin{Form}' };
    const out = await completeSettled('\\usepackage{hyperref}\n\\begin{Form}[Sub', site);
    expect(out.map(c => c.label)).toEqual(['SubmitName', 'SubmitAction']);
  });

  it('returns nothing for a keyval command the corpus has no data for', async () => {
    corpus = { 'latex-document': '' };
    const site: CompletionSite = { kind: 'keyval', from: 0, to: 0, query: '', command: '\\nonexistent' };
    expect(await completeSettled('\\nonexistent[', site)).toEqual([]);
  });
});
