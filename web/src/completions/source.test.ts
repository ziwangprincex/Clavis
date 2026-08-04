import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { buildCompletionSource } from './source';

async function completeAt(text: string) {
  const state = EditorState.create({ doc: text });
  return buildCompletionSource('latex')(new CompletionContext(state, text.length, false));
}

describe('LaTeX completion source', () => {
  it('offers the document environment while typing its name', async () => {
    const result = await completeAt('\\begin{doc');

    expect(result).not.toBeNull();
    expect(result?.from).toBe(0);
    expect(result?.to).toBe('\\begin{doc'.length);
    expect(result?.options.some(option => option.label === '\\begin{document}')).toBe(true);
  });

  it('keeps ordinary command completion working', async () => {
    const result = await completeAt('Text \\sec');

    // `\section` used to be asserted here, but single commands now come from the
    // .cwl corpus, which needs a Tauri runtime this test does not have. What the
    // source layer owns is finding the command site and its replacement range —
    // so that is what this checks. Corpus content is covered by
    // cwlProvider.test.ts and cwlCorpus.test.ts.
    expect(result?.from).toBe(5);
    expect(result?.to).toBe('Text \\sec'.length);
  });

  it('marks cwl candidates so their CM6 placeholders are not re-converted', async () => {
    // Regression guard for the `snippetSyntax` split: a cwl template already in
    // `${1:short title}` form must be applied verbatim, because running it
    // through the legacy `$1default` converter mangles names containing spaces.
    const source = buildCompletionSource('latex');
    const state = EditorState.create({ doc: '\\begin{doc' });
    const result = await source(new CompletionContext(state, 10, false));
    const option = result?.options.find(o => o.label === '\\begin{document}');
    expect(option).toBeDefined();
    expect(typeof option?.apply).toBe('function');
  });
});
