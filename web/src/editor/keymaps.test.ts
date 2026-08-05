import { describe, expect, it } from 'vitest';
import { acceptCompletion, nextSnippetField, prevSnippetField } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { buildEditorKeymap } from './keymaps';

describe('editor keymap composition', () => {
  it('does not duplicate the completion keymap installed by autocompletion()', () => {
    const plainEnterBindings = buildEditorKeymap().filter(binding => binding.key === 'Enter');

    expect(plainEnterBindings).toHaveLength(1);
  });

  it('Tab accepts an open completion before jumping snippets, then indents', () => {
    const tabBindings = buildEditorKeymap().filter(binding => binding.key === 'Tab');

    // `acceptCompletion` returns false with no popup open, `nextSnippetField`
    // with no active snippet, so a plain Tab still indents when neither state
    // is present. Order is what makes the fall-through correct.
    expect(tabBindings[0].run).toBe(acceptCompletion);
    expect(tabBindings[1].run).toBe(nextSnippetField);
    expect(tabBindings[1].shift).toBe(prevSnippetField);
    expect(tabBindings[2].run).toBe(indentWithTab.run);
  });
});
