// Typst completion tests.
//
// Two things matter beyond "does it list functions": that the hand-written
// snippets keep winning where they overlap a builtin, and that an unprefixed
// word does not dump 391 entries into ordinary prose.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypstFuncSig, TypstParamSig } from '../api/tauri';

const listTypstSignatures = vi.fn<() => Promise<TypstFuncSig[]>>();

vi.mock('../api/tauri', () => ({
  hasTauri: () => true,
  ipc: { listTypstSignatures: () => listTypstSignatures() },
}));

const { complete } = await import('./engine');
const { resetSignatureCacheForTests } = await import('./signatures');
const { resetLetCacheForTests } = await import('./typstLetScan');
const { typstProvider } = await import('./typstProvider');
const { detectCompletionSite } = await import('./context');

function param(name: string, extra: Partial<TypstParamSig> = {}): TypstParamSig {
  return {
    name,
    typeName: 'content',
    docs: '',
    required: false,
    positional: false,
    named: true,
    variadic: false,
    settable: false,
    ...extra,
  };
}

function fn(name: string, params: TypstParamSig[] = [], returns = 'content'): TypstFuncSig {
  return { name, title: name, returns, mathOnly: false, params };
}

/**
 * Ask the provider directly, once the async table has settled.
 *
 * Labels come back hash-prefixed (`#figure`) because the `#` is part of the
 * range CodeMirror replaces and filters against — see `popupIntegration.test.ts`
 * for why that matters. `find` below strips it so the cases stay readable.
 */
async function offer(text: string) {
  const request = { language: 'typst' as const, text, position: text.length, explicit: false };
  const site = detectCompletionSite(request);
  if (!site) return [];
  typstProvider.complete(request, site);
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  return typstProvider.complete(request, site) as Awaited<ReturnType<typeof typstProvider.complete>>;
}

/** Candidate by function name, ignoring the `#` the label carries. */
function byName(candidates: Awaited<ReturnType<typeof offer>>, name: string) {
  return candidates.find(c => c.label === name || c.label === `#${name}`);
}

/** Function names offered, with the `#` stripped. */
function names(candidates: Awaited<ReturnType<typeof offer>>): string[] {
  return candidates.map(c => (c.label.startsWith('#') ? c.label.slice(1) : c.label));
}

beforeEach(() => {
  listTypstSignatures.mockReset();
  resetSignatureCacheForTests();
  resetLetCacheForTests();
  listTypstSignatures.mockResolvedValue([
    fn('figure', [param('body', { positional: true, required: true, named: false }), param('caption')]),
    fn('lorem', [param('words', { positional: true, required: true, named: false, typeName: 'int' })]),
    fn('pagebreak'),
    fn('polygon', [param('vertices', { positional: true, variadic: true, typeName: 'array' })]),
    fn('calc.pow', [
      param('base', { positional: true, required: true, named: false }),
      param('exponent', { positional: true, required: true, named: false }),
    ], 'int | float'),
    fn('calc.abs', [param('value', { positional: true, required: true, named: false })], 'int'),
  ]);
});

describe('call shape matches how Typst is written', () => {
  // The complaint that prompted these: we inserted `#emph()` where every Typst
  // document writes `#emph[...]`. Typst's spec is that trailing content blocks
  // are sugar for final positional arguments ("list([A], [B]) is equivalent to
  // list[A][B]"), so a trailing content-typed positional belongs in a bracket.
  // Param metadata below is copied from the real table — see `typst_sig.rs`.

  beforeEach(() => {
    listTypstSignatures.mockResolvedValue([
      // body!P:content — the plain content-block case.
      fn('emph', [param('body', { positional: true, required: true, named: false })]),
      // delta is named-only and must not reach the template.
      fn('strong', [
        param('delta', { typeName: 'int' }),
        param('body', { positional: true, required: true, named: false }),
      ]),
      // dest!P:str then body!P:content — a paren argument AND a bracket.
      fn('link', [
        param('dest', { positional: true, required: true, named: false, typeName: 'str | label' }),
        param('body', { positional: true, required: true, named: false }),
      ]),
      // children!PV:content — variadic content still takes a block.
      fn('list', [
        param('tight', { typeName: 'bool' }),
        param('children', { positional: true, variadic: true, named: false }),
      ]),
      // No content anywhere — stays in parens.
      fn('calc.pow', [
        param('base', { positional: true, required: true, named: false, typeName: 'int | float' }),
        param('exponent', { positional: true, required: true, named: false, typeName: 'int | float' }),
      ], 'int | float'),
      // Nothing required at all.
      fn('pagebreak', [param('weak', { typeName: 'bool' })]),
      // A required positional that is a plain int, not content.
      fn('lorem', [param('words', { positional: true, required: true, named: false, typeName: 'int' })]),
      // figure's body IS content-typed, but idiomatic usage passes an image.
      fn('figure', [
        param('body', { positional: true, required: true, named: false }),
        param('caption', { typeName: 'content | none' }),
      ]),
    ]);
  });

  it('puts a trailing content parameter in a content block', async () => {
    expect(byName(await offer('#emph'), 'emph')?.insertText).toBe('#emph[${1:body}]');
  });

  it('ignores named-only parameters when choosing the shape', async () => {
    // `strong` has a named `delta` before the body; it must not end up in parens.
    expect(byName(await offer('#stro'), 'strong')?.insertText).toBe('#strong[${1:body}]');
  });

  it('keeps a leading positional in parens and the content in a block', async () => {
    // `#link("url")[text]` is the documented form.
    expect(byName(await offer('#link'), 'link')?.insertText).toBe('#link("${1:dest}")[${2:body}]');
  });

  it('treats a variadic content parameter as a content block', async () => {
    expect(byName(await offer('#list'), 'list')?.insertText).toBe('#list[${1:children}]');
  });

  it('uses parens when no parameter takes content', async () => {
    expect(byName(await offer('#calc.p'), 'calc.pow')?.insertText)
      .toBe('#calc.pow(${1:base}, ${2:exponent})');
  });

  it('uses parens for a required non-content positional', async () => {
    expect(byName(await offer('#lore'), 'lorem')?.insertText).toBe('#lorem(${1:words})');
  });

  it('emits empty parens when nothing is required', async () => {
    expect(byName(await offer('#pageb'), 'pagebreak')?.insertText).toBe('#pagebreak()');
  });

  it('keeps figure in parens despite its content-typed body', async () => {
    // Typst's own examples all write `#figure(image("a.png"), caption: [..])`,
    // because the body is an image rather than prose.
    expect(byName(await offer('#figu'), 'figure')?.insertText).toContain('(');
    expect(byName(await offer('#figu'), 'figure')?.insertText).not.toBe('#figure[${1:body}]');
  });
});

describe('math mode', () => {
  // `$...$` reaches a different scope and uses a different call syntax: `frac`
  // and `vec` exist only there, and calls inside take no `#`. Offering `#frac`
  // in markup proposes code that does not compile.
  beforeEach(() => {
    listTypstSignatures.mockResolvedValue([
      { ...fn('frac', [
        param('num', { positional: true, required: true, named: false }),
        param('denom', { positional: true, required: true, named: false }),
      ]), mathOnly: true },
      { ...fn('vec', [param('children', { positional: true, variadic: true })]), mathOnly: true },
      fn('figure', [param('body', { positional: true, required: true, named: false })]),
      fn('text', [param('body', { positional: true, required: true, named: false })]),
    ]);
  });

  it('hides math-only functions in markup', async () => {
    expect(names(await offer('#fra'))).not.toContain('frac');
  });

  it('offers math-only functions inside dollars', async () => {
    expect(names(await offer('$ fra'))).toContain('frac');
  });

  it('needs no hash inside dollars', async () => {
    // A bare word is a real call site in math, unlike in markup.
    const frac = byName(await offer('$ fra'), 'frac');
    expect(frac?.insertText).toBe('frac(${1:num}, ${2:denom})');
  });

  it('still hides math-only functions after the dollars close', async () => {
    expect(names(await offer('$ x $ and #fra'))).not.toContain('frac');
  });

  it('is not fooled by an escaped dollar', async () => {
    expect(names(await offer('costs \\$5 then #fra'))).not.toContain('frac');
  });

  it('ignores a dollar inside a line comment', async () => {
    expect(names(await offer('// price $5\n#fra'))).not.toContain('frac');
  });
});

describe('ranking for a bare hash', () => {
  it('lifts authoring verbs above the alphabetical mass', async () => {
    // Alphabetical order puts `abs`, `align`, `alpha`, `beta`, `binom` on the
    // first screen and buries `heading` and `table`. Boost has to counter that.
    listTypstSignatures.mockResolvedValue([
      fn('assert'),
      fn('heading', [param('body', { positional: true, required: true, named: false })]),
      fn('bit-not'),
    ]);
    const results = await offer('#');
    const heading = byName(results, 'heading');
    const assert = byName(results, 'assert');
    expect((heading?.boost ?? 0)).toBeGreaterThan(assert?.boost ?? 0);
  });

  it('ranks common math functions first inside dollars', async () => {
    listTypstSignatures.mockResolvedValue([
      { ...fn('frac'), mathOnly: true },
      { ...fn('fsscript'), mathOnly: true },
    ]);
    // A query is needed: a trailing space is not a word site, so `offer` would
    // return nothing and both lookups would be undefined.
    const results = await offer('$ f');
    expect(byName(results, 'frac')?.boost)
      .toBeGreaterThan(byName(results, 'fsscript')?.boost ?? 0);
  });

  it('does not let a common builtin outrank a curated snippet', async () => {
    // `mergeCandidates` keeps the highest boost per label, and the curated
    // `#figure(image("path.png"), caption: [..])` is better than anything a
    // signature can produce. See the boost table in `typstProvider.ts`: the
    // curated common tier is 3, so a generated common candidate must stay below.
    listTypstSignatures.mockResolvedValue([
      fn('figure', [param('body', { positional: true, required: true, named: false })]),
    ]);
    expect(byName(await offer('#figu'), 'figure')?.boost).toBeLessThan(3);
  });
});

describe('typst function completion', () => {
  it('offers builtin functions the hand-written snippets never had', async () => {
    // `polygon` and `pagebreak` are real typst functions; before this provider
    // the only source was an 82-entry hand-written list.
    const labels = names(await offer('#pol'));
    expect(labels).toContain('polygon');
  });

  it('fills required positional parameters with their real names', async () => {
    const lorem = byName(await offer('#lor'), 'lorem');
    // Not a positional `$1` placeholder: the name comes from `Func::params()`.
    expect(lorem?.insertText).toBe('#lorem(${1:words})');
    expect(lorem?.snippet).toBe(true);
  });

  it('emits a bare call when nothing is required', async () => {
    const pagebreak = byName(await offer('#pageb'), 'pagebreak');
    expect(pagebreak?.insertText).toBe('#pagebreak()');
    expect(pagebreak?.snippet).toBe(false);
  });

  it('leaves optional and named-only parameters out of the template', async () => {
    // `caption` is named-only; inserting it would add more text than it saves.
    const figure = byName(await offer('#figu'), 'figure');
    expect(figure?.insertText).toBe('#figure(${1:body})');
  });

  it('offers a variadic non-content parameter as a paren argument', async () => {
    // `polygon(..vertices)` takes arrays of coordinates, so it stays in parens —
    // and seeding the first one is more useful than a bare `()`.
    const polygon = byName(await offer('#poly'), 'polygon');
    expect(polygon?.insertText).toBe('#polygon(${1:vertices})');
  });

  it('shows the return type as the detail', async () => {
    const pow = byName(await offer('#calc.p'), 'calc.pow');
    expect(pow?.detail).toContain('int | float');
  });

  it('preserves the leading hash in the insert text', async () => {
    // The site starts at the `#`, so the insert has to replace it.
    for (const candidate of await offer('#lor')) {
      expect(candidate.insertText.startsWith('#')).toBe(true);
    }
  });
});

describe('nested (dotted) names', () => {
  it('matches on the full dotted path', async () => {
    expect(names(await offer('#calc.p'))).toContain('calc.pow');
  });

  it('matches on the segment after the dot', async () => {
    // Typing `pow` should still find `calc.pow`.
    expect(names(await offer('#pow'))).toContain('calc.pow');
  });

  it('ranks nested names below top-level ones', async () => {
    const results = await offer('#p');
    const nested = byName(results, 'calc.pow');
    const top = byName(results, 'pagebreak');
    expect((nested?.boost ?? 0)).toBeLessThan(top?.boost ?? 0);
  });

  it('includes nested names in an unprefixed listing', async () => {
    // typst.app lists `calc.*` / `sys.*` for a bare `#`, and the whole point of
    // the nested walk was to reach them — filtering them out here would have
    // thrown away two thirds of the coverage.
    const labels = names(await offer('#'));
    expect(labels).toContain('figure');
    expect(labels).toContain('calc.pow');
  });
});

describe('Typst set/show rule context', () => {
  it('offers only settable standard-library functions after #set', async () => {
    listTypstSignatures.mockResolvedValue([
      fn('text', [param('size', { settable: true })]),
      fn('figure', [param('body', { positional: true, required: true, named: false })]),
    ]);
    const results = await offer('#set te');
    expect(byName(results, 'text')).toMatchObject({ insertText: 'text', detail: 'settable function' });
    expect(names(results)).not.toContain('figure');
  });

  it('offers a show selector without inserting another hash', async () => {
    const results = await offer('#show fig');
    expect(byName(results, 'figure')).toMatchObject({ insertText: 'figure', detail: 'show selector' });
  });
});

describe('workspace static imports', () => {
  it('offers a statically imported function with its exported parameter names', async () => {
    const text = '#import "lib/helpers.typ": *\n#car';
    const request = {
      language: 'typst' as const, text, position: text.length, explicit: false,
      workspace: {
        rootPath: '/paper', activePath: '/paper/main.typ', documents: [
          { path: '/paper/main.typ', language: 'typst' as const, text },
          { path: '/paper/lib/helpers.typ', language: 'typst' as const, text: '#let card(title, width: 4cm) = []' },
        ],
      },
    };
    const site = detectCompletionSite(request)!;
    typstProvider.complete(request, site);
    await new Promise(resolve => setTimeout(resolve, 0));
    const card = byName(typstProvider.complete(request, site) as Awaited<ReturnType<typeof offer>>, 'card');
    expect(card).toMatchObject({ insertText: '#card(${1:title})', detail: 'imported function' });
  });

  it('does not offer a function from a dynamic import expression', async () => {
    const text = '#import path\n#car';
    const request = {
      language: 'typst' as const, text, position: text.length, explicit: false,
      workspace: {
        rootPath: '/paper', activePath: '/paper/main.typ', documents: [
          { path: '/paper/main.typ', language: 'typst' as const, text },
          { path: '/paper/lib/helpers.typ', language: 'typst' as const, text: '#let card(title) = []' },
        ],
      },
    };
    const site = detectCompletionSite(request)!;
    const labels = names(typstProvider.complete(request, site) as Awaited<ReturnType<typeof offer>>);
    expect(labels).not.toContain('card');
  });
});

describe('document-local #let functions', () => {
  it('offers functions defined in the document', async () => {
    const labels = names(await offer('#let greet(name) = []\n#gr'));
    expect(labels).toContain('greet');
  });

  it('ranks local helpers above builtins', async () => {
    const results = await offer('#let polyfill(a) = []\n#pol');
    const local = byName(results, 'polyfill');
    const builtin = byName(results, 'polygon');
    expect((local?.boost ?? 0)).toBeGreaterThan(builtin?.boost ?? 0);
  });

  it('fills only parameters that have no default', async () => {
    const results = await offer('#let card(title, width: 4cm) = []\n#car');
    expect(byName(results, 'card')?.insertText).toBe('#card(${1:title})');
  });
});

describe('not flooding ordinary prose', () => {
  it('offers nothing for a bare word without a hash', async () => {
    // `page` is a real function, but plain prose must not trigger 391 entries.
    expect(await offer('writing about page')).toEqual([]);
  });

  it('still answers when the word carries a hash', async () => {
    expect((await offer('#page')).length).toBeGreaterThan(0);
  });

  it('yields nothing for latex documents', async () => {
    const request = { language: 'latex' as const, text: '\\fr', position: 3, explicit: false };
    const site = detectCompletionSite(request);
    expect(typstProvider.complete(request, site!)).toEqual([]);
  });
});

describe('merging with the hand-written snippets', () => {
  /**
   * Run the full engine after the signature table has loaded. The first request
   * only starts the fetch — completion is synchronous by design — so a test that
   * asks once sees no builtins at all.
   */
  async function merged(text: string) {
    const request = { language: 'typst' as const, text, position: text.length, explicit: false };
    await complete(request);
    await new Promise(resolve => setTimeout(resolve, 0));
    return complete(request);
  }

  it('keeps the richer curated template where labels collide', async () => {
    // `snippets.ts` has `figure(image("path.png"), caption: [caption])`, which is
    // more useful than anything derivable from Func::params(). mergeCandidates
    // keys on the label and keeps the highest boost, so the snippet must win.
    const result = await merged('#figu');
    const figure = byName(result?.candidates ?? [], 'figure');
    expect(figure?.insertText).toContain('image("path.png")');
  });

  it('still surfaces builtins that have no curated snippet', async () => {
    const result = await merged('#poly');
    expect(names(result?.candidates ?? [])).toContain('polygon');
  });
});
