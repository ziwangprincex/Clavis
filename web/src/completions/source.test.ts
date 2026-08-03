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

    expect(result?.from).toBe(5);
    expect(result?.options.some(option => option.label === '\\section')).toBe(true);
  });
});
