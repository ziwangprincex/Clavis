import {
  acceptCompletion,
  closeBracketsKeymap,
  nextSnippetField,
  prevSnippetField,
} from '@codemirror/autocomplete';
import { cursorDocStart, defaultKeymap, historyKeymap, indentWithTab, selectDocStart } from '@codemirror/commands';
import { foldKeymap } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import type { Command, KeyBinding } from '@codemirror/view';

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
/**
 * Document start, with the top of the page in view. CodeMirror scrolls only
 * the caret's line into view, which left the page's top padding above the
 * window and the first heading cut under the toolbar. Scrolling to 0 first
 * leaves its own scroll-into-view nothing to do.
 */
const toDocumentTop = (command: Command): Command => view => {
  if (!command(view)) return false;
  view.scrollDOM.scrollTop = 0;
  return true;
};

export function buildEditorKeymap(): readonly KeyBinding[] {
  return [
    { key: 'Mod-Home', run: toDocumentTop(cursorDocStart), shift: toDocumentTop(selectDocStart) },
    { mac: 'Cmd-ArrowUp', run: toDocumentTop(cursorDocStart), shift: toDocumentTop(selectDocStart) },
    { key: 'Tab', run: acceptCompletion },
    { key: 'Tab', run: nextSnippetField, shift: prevSnippetField },
    indentWithTab,
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    ...foldKeymap,
    // Shift+Mod+L toggles the sidebar (Typora); CodeMirror's select-all-matches would take it.
    ...searchKeymap.filter(binding => binding.key !== 'Mod-Shift-l'),
  ];
}
