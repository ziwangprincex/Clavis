// Signature resolution tests.
//
// The delicate part is placing the active parameter. Typst options are
// named-only and must not consume a positional slot, so `#figure(body, |` has to
// skip past every option to reach the second *positional* parameter rather than
// pointing at whatever sits second in the list.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypstFuncSig, TypstParamSig } from '../api/tauri';

const listTypstSignatures = vi.fn<() => Promise<TypstFuncSig[]>>();
let tauriPresent = true;

vi.mock('../api/tauri', () => ({
  hasTauri: () => tauriPresent,
  ipc: { listTypstSignatures: () => listTypstSignatures() },
}));

const findCwlCommand = vi.fn();
vi.mock('./cwlProvider', () => ({
  findCwlCommand: (text: string, name: string) => findCwlCommand(text, name),
}));

const { detectCallSite } = await import('./callSite');
const { resetSignatureCacheForTests, signatureFor } = await import('./signatures');
const { resetLetCacheForTests } = await import('./typstLetScan');

function param(name: string, extra: Partial<TypstParamSig> = {}): TypstParamSig {
  return {
    name,
    typeName: 'content',
    docs: `docs for ${name}`,
    required: false,
    positional: false,
    named: true,
    variadic: false,
    settable: false,
    ...extra,
  };
}

/** Resolve the signature at the end of `text`, the way the tooltip does. */
async function sigAt(text: string, language: 'typst' | 'latex' = 'typst') {
  const site = detectCallSite(text, text.length, language);
  if (!site) return null;
  // The builtin table loads asynchronously; let the fetch settle, as successive
  // keystrokes would.
  signatureFor(text, site, language);
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  return signatureFor(text, site, language);
}

beforeEach(() => {
  tauriPresent = true;
  listTypstSignatures.mockReset();
  findCwlCommand.mockReset();
  findCwlCommand.mockReturnValue(null);
  resetSignatureCacheForTests();
  resetLetCacheForTests();
  listTypstSignatures.mockResolvedValue([
    {
      name: 'figure',
      title: 'Figure',
      returns: 'content',
      mathOnly: false,
      params: [
        param('body', { positional: true, required: true, named: false }),
        param('placement', { settable: true }),
        param('caption', { typeName: 'none | content', settable: true }),
      ],
    },
    {
      name: 'calc.pow',
      title: 'Power',
      returns: 'int | float',
      mathOnly: false,
      params: [
        param('base', { positional: true, required: true, named: false }),
        param('exponent', { positional: true, required: true, named: false }),
      ],
    },
  ]);
});

describe('typst builtin signatures', () => {
  it('resolves a builtin and marks the first parameter active', async () => {
    const sig = await sigAt('#figure(');
    expect(sig).toMatchObject({ name: 'figure', returns: 'content', userDefined: false });
    expect(sig?.params.map(p => p.name)).toEqual(['body', 'placement', 'caption']);
    expect(sig?.activeIndex).toBe(0);
  });

  it('places a named argument by name, not position', async () => {
    const sig = await sigAt('#figure(img, caption: ');
    expect(sig?.activeIndex).toBe(2);
    expect(sig?.params[2].name).toBe('caption');
  });

  it('does not let named-only options consume a positional slot', async () => {
    // `figure` has exactly one positional parameter, so a second positional
    // argument matches nothing — pointing at `placement` would be wrong.
    const sig = await sigAt('#figure(img, ');
    expect(sig?.activeIndex).toBe(-1);
  });

  it('counts through several positional parameters', async () => {
    const sig = await sigAt('#calc.pow(2, ');
    expect(sig?.name).toBe('calc.pow');
    expect(sig?.activeIndex).toBe(1);
    expect(sig?.params[1].name).toBe('exponent');
  });

  it('keeps only settable parameters in a set rule', async () => {
    // `#set figure(..)` cannot take `body`; typst filters the same way.
    const sig = await sigAt('#set figure(');
    expect(sig?.params.map(p => p.name)).toEqual(['placement', 'caption']);
  });

  it('carries the type and docs through for display', async () => {
    const sig = await sigAt('#figure(img, caption: ');
    expect(sig?.params[2].type).toBe('none | content');
    expect(sig?.params[2].docs).toBe('docs for caption');
  });

  it('is null for an unknown function', async () => {
    expect(await sigAt('#nosuchfunc(')).toBeNull();
  });

  it('survives a backend failure and retries later', async () => {
    resetSignatureCacheForTests();
    listTypstSignatures.mockRejectedValueOnce(new Error('ipc down'));
    expect(await sigAt('#figure(')).toBeNull();

    // A failure must not latch: the table loads once the backend recovers.
    resetSignatureCacheForTests();
    expect(await sigAt('#figure(')).toMatchObject({ name: 'figure' });
  });

  it('returns null without a Tauri runtime rather than throwing', async () => {
    tauriPresent = false;
    resetSignatureCacheForTests();
    expect(await sigAt('#figure(')).toBeNull();
  });
});

describe('typst #let signatures', () => {
  it('reads parameters from the document', async () => {
    const sig = await sigAt('#let greet(name, punct: "!") = []\n#greet(');
    expect(sig).toMatchObject({ name: 'greet', userDefined: true });
    expect(sig?.params.map(p => p.name)).toEqual(['name', 'punct']);
    expect(sig?.activeIndex).toBe(0);
  });

  it('shows a default expression in place of a type', async () => {
    // Closure parameter types are not introspectable, so the default is the
    // most informative thing available.
    const sig = await sigAt('#let f(n: 3) = []\n#f(');
    expect(sig?.params[0].type).toBe('= 3');
  });

  it('marks a parameter without a default as required', async () => {
    const sig = await sigAt('#let f(a, b: 1) = []\n#f(');
    expect(sig?.params[0].required).toBe(true);
    expect(sig?.params[1].required).toBe(false);
  });

  it('lets a variadic parameter absorb later arguments', async () => {
    const sig = await sigAt('#let row(label, ..cells) = []\n#row(a, b, c, ');
    expect(sig?.params[1].variadic).toBe(true);
    expect(sig?.activeIndex).toBe(1);
  });

  it('shadows a builtin of the same name', async () => {
    // A document-level `#let figure` wins at runtime, so it must win here too.
    const sig = await sigAt('#let figure(custom) = []\n#figure(');
    expect(sig).toMatchObject({ userDefined: true });
    expect(sig?.params.map(p => p.name)).toEqual(['custom']);
  });
});

describe('latex signatures from the cwl corpus', () => {
  it('recovers argument names from a snippet template', async () => {
    findCwlCommand.mockReturnValue({
      name: 'frac',
      snippet: '\\frac{${1:num}}{${2:den}}',
    });
    const sig = await sigAt('\\frac{', 'latex');
    expect(sig?.params.map(p => p.name)).toEqual(['num', 'den']);
    expect(sig?.activeIndex).toBe(0);
  });

  it('advances to the second argument group', async () => {
    findCwlCommand.mockReturnValue({
      name: 'frac',
      snippet: '\\frac{${1:num}}{${2:den}}',
    });
    expect((await sigAt('\\frac{a}{', 'latex'))?.activeIndex).toBe(1);
  });

  it('marks a bracketed argument optional', async () => {
    findCwlCommand.mockReturnValue({
      name: 'includegraphics',
      snippet: '\\includegraphics[${1:keyvals}]{${2:imagefile}}',
    });
    const sig = await sigAt('\\includegraphics[', 'latex');
    expect(sig?.params[0]).toMatchObject({ name: 'keyvals', required: false });
    expect(sig?.params[1]).toMatchObject({ name: 'imagefile', required: true });
  });

  it('is null for a command with no arguments', async () => {
    findCwlCommand.mockReturnValue({ name: 'ldots', snippet: '\\ldots' });
    expect(await sigAt('\\frac{', 'latex')).toBeNull();
  });

  it('is null while the corpus is still loading', async () => {
    findCwlCommand.mockReturnValue(null);
    expect(await sigAt('\\frac{', 'latex')).toBeNull();
  });
});
