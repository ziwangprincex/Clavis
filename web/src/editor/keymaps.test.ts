import { describe, expect, it } from 'vitest';
import { acceptCompletion, nextSnippetField, prevSnippetField } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { buildEditorKeymap } from './keymaps';
import type { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';

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

  it('leaves Shift+Mod+L to the app, which toggles the sidebar', () => {
    expect(buildEditorKeymap().some(binding => binding.key === 'Mod-Shift-l')).toBe(false);
    expect(buildEditorKeymap().some(binding => binding.key === 'Mod-f')).toBe(true);
  });

  it('goes to the document start with the top of the page in view', () => {
    // Regression: the caret's line was scrolled into view, so the page's top
    // padding stayed above the window and the first heading sat cut under the toolbar.
    // The first binding for a key is the one CodeMirror runs.
    const top = [
      buildEditorKeymap().find(binding => binding.key === 'Mod-Home')!,
      buildEditorKeymap().find(binding => binding.mac === 'Cmd-ArrowUp')!,
    ];
    for (const binding of top) {
      for (const run of [binding.run!, binding.shift!]) {
        const view = {
          scrollDOM: { scrollTop: 73 },
          state: EditorState.create({ doc: 'line\n'.repeat(200), selection: EditorSelection.cursor(900) }),
          dispatch(tr: Transaction) { view.state = tr.state; },
        } as unknown as EditorView & { state: EditorState };
        expect(run(view)).toBe(true);
        expect(view.state.selection.main.head).toBe(0);
        expect(view.scrollDOM.scrollTop).toBe(0);
      }
    }
  });
});
