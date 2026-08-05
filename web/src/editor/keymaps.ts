import {
  acceptCompletion,
  closeBracketsKeymap,
  nextSnippetField,
  prevSnippetField,
} from '@codemirror/autocomplete';
import { defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { foldKeymap } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import type { KeyBinding } from '@codemirror/view';

/**
 * Build the editor keymap in handling priority order.
 *
 * Autocompletion installs its own default keymap at Prec.highest; that keymap
 * binds Enter to `acceptCompletion` but NOT Tab (TeXstudio/TeXifier muscle
 * memory expects Tab to accept too). The Tab bindings below are deliberately
 * ordered before `indentWithTab`: each `run` returns false when its state is
 * absent (no open popup / no active snippet), so a plain Tab still indents
 * when there is nothing to accept. Shift-Tab walks snippet fields backwards
 * and otherwise outdents.
 */
export function buildEditorKeymap(): readonly KeyBinding[] {
  return [
    { key: 'Tab', run: acceptCompletion },
    { key: 'Tab', run: nextSnippetField, shift: prevSnippetField },
    indentWithTab,
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...searchKeymap,
  ];
}
