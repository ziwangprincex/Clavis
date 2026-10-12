// Typora's focus and typewriter modes. The paragraph holding the cursor is
// marked so Focus mode can fade the rest; paragraphs are runs of non-blank
// lines, which reads the same in Markdown, LaTeX and Typst. Typewriter
// scrolling keeps the line being written in the middle of the window.

import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

const current = Decoration.line({ class: 'cm-current-block' });
/** A paragraph longer than this (code without blank lines) is cut off around the cursor. */
const REACH = 200;

export function currentBlockLines(state: EditorState): { first: number; last: number } {
  const { doc } = state;
  const line = doc.lineAt(state.selection.main.head);
  let first = line.number, last = line.number;
  if (!line.text.trim()) return { first, last };
  while (first > 1 && line.number - first < REACH && doc.line(first - 1).text.trim()) first--;
  while (last < doc.lines && last - line.number < REACH && doc.line(last + 1).text.trim()) last++;
  return { first, last };
}

function decorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { first, last } = currentBlockLines(state);
  for (let n = first; n <= last; n++) {
    const from = state.doc.line(n).from;
    builder.add(from, from, current);
  }
  return builder.finish();
}

export const currentBlock: Extension = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorations(view.state); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet) this.decorations = decorations(update.state);
  }
}, { decorations: plugin => plugin.decorations });

/** Typing and keyboard movement centre the cursor line; mouse clicks do not jump the page. */
export const typewriterScrolling: Extension = [
  EditorState.transactionExtender.of(tr => {
    const keyboard = tr.isUserEvent('input') || tr.isUserEvent('delete') || (tr.isUserEvent('select') && !tr.isUserEvent('select.pointer'));
    if (!tr.selection || !keyboard) return null;
    return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) };
  }),
  // Room below the last line, so it too can reach the middle.
  EditorView.editorAttributes.of({ class: 'cm-typewriter' }),
];
