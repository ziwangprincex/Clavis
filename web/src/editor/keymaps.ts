import { closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { foldKeymap } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import type { KeyBinding } from '@codemirror/view';

/**
 * Build the editor keymap in handling priority order.
 *
 * Autocompletion installs its own default keymap at Prec.highest. This list
 * deliberately does not duplicate it; it only contains the editor's remaining
 * bindings in their normal fallback order.
 */
export function buildEditorKeymap(): readonly KeyBinding[] {
  return [
    indentWithTab,
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...searchKeymap,
  ];
}
