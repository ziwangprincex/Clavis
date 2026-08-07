import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CompletionContext } from '@codemirror/autocomplete';
import type { TypstFuncSig } from '../api/tauri';

/**
 * A stand-in for the Rust signature table.
 *
 * The real one is 432 functions; this generates a comparable spread including
 * dotted names, because the thing under test is how many candidates reach the
 * popup, not their content.
 */
function fakeTable(): TypstFuncSig[] {
  const top = Array.from({ length: 120 }, (_, i) => `func${i}`);
  const nested = Array.from({ length: 60 }, (_, i) => `calc.op${i}`);
  return [...top, ...nested, 'figure', 'polygon', 'calc.pow'].map(name => ({
    name,
    title: name,
    returns: 'content',
    mathOnly: false,
    params: [],
  }));
}

vi.mock('../api/tauri', () => ({
  hasTauri: () => true,
  ipc: { listTypstSignatures: () => Promise.resolve(fakeTable()) },
}));

const { buildCompletionSource } = await import('./source');
const { prefetchTypstSignatures, resetSignatureCacheForTests } = await import('./signatures');

/**
 * Drive the real CodeMirror completion source, then apply CodeMirror's own
 * filtering the way the popup does.
 *
 * Unit tests that call the provider directly cannot catch a label/pattern
 * mismatch: CodeMirror filters `option.label` against the document text between
 * `from` and `to`, so a label that omits a prefix the range includes is dropped
 * *after* our code returns it. That is invisible to any test that stops at the
 * provider boundary — which is exactly how a "no builtins in the popup" bug
 * survived a green provider suite.
 */
async function popupLabels(text: string, warm = true): Promise<string[]> {
  const state = EditorState.create({ doc: text });
  const view = { state } as EditorView;
  const source = buildCompletionSource('typst');
  const context = new CompletionContext(state, text.length, true, view);

  if (warm) {
    // What `EditorPane` does on tab switch. Without it the first request only
    // starts the IPC fetch and the popup shows snippets alone.
    prefetchTypstSignatures();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const result = await source(context);
  if (!result) return [];

  const pattern = state.sliceDoc(result.from, result.to);
  // Mirror CM6's own gate: an option survives only if its label matches the
  // pattern taken from the replaced range.
  return result.options
    .filter(option => {
      const label = option.label.toLowerCase();
      let at = 0;
      for (const ch of pattern.toLowerCase()) {
        at = label.indexOf(ch, at);
        if (at === -1) return false;
        at++;
      }
      return true;
    })
    .map(option => option.label);
}

beforeEach(() => {
  resetSignatureCacheForTests();
});

describe('what the popup actually shows for typst', () => {
  it('survives CodeMirror filtering when the query carries a hash', async () => {
    // The `#` is inside the replaced range, so it is part of the filter pattern.
    // Labels must account for it or every candidate is silently dropped.
    const labels = await popupLabels('#figu');
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toContain('#figure');
  });

  it('offers a large builtin list for a bare hash', async () => {
    // typst.app shows well over a hundred entries here; anything in the dozens
    // means the builtin table is not reaching the popup.
    const labels = await popupLabels('#');
    expect(labels.length).toBeGreaterThan(100);
  });

  it('includes dotted module names in the bare-hash listing', async () => {
    // `calc.*` and `sys.*` are part of what typst.app lists for `#`.
    expect(await popupLabels('#')).toContain('#calc.pow');
  });

  it('narrows as the user types', async () => {
    const labels = await popupLabels('#poly');
    expect(labels).toContain('#polygon');
    expect(labels.length).toBeLessThan(20);
  });

  it('falls back to curated snippets on a cold cache', async () => {
    // Completion is synchronous, so the first request can only start the IPC
    // fetch — that is why `EditorPane` warms the table on tab switch. What the
    // user sees meanwhile is the curated snippets, not the 391 builtins; before
    // the labels were hash-normalised it was only the 17 that already carried a
    // `#`, since CodeMirror filters bare labels out against a `#` pattern.
    const cold = await popupLabels('#', false);
    expect(cold.length).toBeGreaterThan(40);
    expect(cold).toContain('#emph');
    expect(cold).not.toContain('#polygon');
    // Math-only entries stay out of markup: `#alpha` and `#frac` do not compile.
    expect(cold).not.toContain('#alpha');
    expect(cold).not.toContain('#frac');
  });
});
