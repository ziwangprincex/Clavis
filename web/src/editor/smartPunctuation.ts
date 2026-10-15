// Typora's smart punctuation for Markdown, off unless the setting is on:
// `--` becomes an en dash and a third `-` an em dash, straight quotes become
// curly ones (a typed `"` opens a “” pair, as auto-closing does with straight
// quotes), and an apostrophe after a letter becomes ’. Code, formulas, links,
// HTML and front matter keep what was typed. Each conversion is its own undo
// step, so ⌘Z gives back the plain character.

import { EditorSelection, Prec, type EditorState, type Extension } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { EditorView } from '@codemirror/view';

/** Places whose text is taken literally. */
const LITERAL = new Set([
  'InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'InlineMath', 'DisplayMath', 'URL', 'Autolink',
  'HTMLBlock', 'HTMLTag', 'Frontmatter', 'LinkDestination', 'CommentBlock', 'ProcessingInstruction',
]);

function literal(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (LITERAL.has(node.name)) return true;
  }
  return false;
}

const OPENS_AFTER = /[\s([{<“‘—–\-/]/;

/** How many of `open` in `text` are still waiting for `close`. */
const unmatched = (text: string, open: string, close: string) => [...text].reduce((n, ch) => ch === open ? n + 1 : ch === close && n > 0 ? n - 1 : n, 0);

export interface SmartEdit { from: number; to: number; insert: string; cursor: number }

/** The replacement for typing `text` at `pos` (the character is not yet in the document), or null. */
export function smartPunctuation(state: EditorState, pos: number, text: string): SmartEdit | null {
  if (text !== '-' && text !== '"' && text !== "'") return null;
  if (literal(state, pos)) return null;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const prev = before.slice(-1);
  if (text === '-') {
    // Rules, lists, front matter and table delimiters start with dashes; only dashes inside text turn.
    if (!/\S/.test(before.slice(0, -1)) || /^\s*\|?[\s:|-]*$/.test(line.text)) return null;
    if (prev === '-' && before.slice(-2, -1) !== '-') return { from: pos - 1, to: pos, insert: '–', cursor: pos };
    if (prev === '–') return { from: pos - 1, to: pos, insert: '—', cursor: pos };
    return null;
  }
  if (text === "'") {
    const closing = /[\p{L}\p{N}.,!?)\]]/u.test(prev) || unmatched(before, '‘', '’') > 0;
    return { from: pos, to: pos, insert: closing ? '’' : '‘', cursor: pos + 1 };
  }
  const next = line.text.slice(pos - line.from, pos - line.from + 1);
  if (next === '”') return { from: pos, to: pos, insert: '', cursor: pos + 1 };
  const closing = unmatched(before, '“', '”') > 0 && !/\s/.test(prev || ' ');
  if (closing) return { from: pos, to: pos, insert: '”', cursor: pos + 1 };
  if (prev && !OPENS_AFTER.test(prev) && !/\p{Script=Han}|[　-〿＀-￯]/u.test(prev)) return { from: pos, to: pos, insert: '”', cursor: pos + 1 };
  // An opening quote before a space or the line end gets its partner, as auto-closing does.
  const pair = !next || /[\s)\]}.,;:!?]/.test(next);
  return { from: pos, to: pos, insert: pair ? '“”' : '“', cursor: pos + 1 };
}

/** Converts as the characters are typed; above auto-closing, which would pair straight quotes. */
export const smartPunctuationInput: Extension = Prec.highest(EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  if (from !== to || state.selection.ranges.length > 1 || !state.selection.main.empty) return false;
  const edit = smartPunctuation(state, from, text);
  if (!edit) return false;
  // Typing the closing quote of a pair steps over it.
  if (!edit.insert) {
    view.dispatch({ selection: EditorSelection.cursor(edit.cursor), userEvent: 'select' });
    return true;
  }
  // The plain character first, then the conversion as its own undo step:
  // it replaces [edit.from, edit.to] plus the character just typed.
  view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
  view.dispatch({
    changes: { from: edit.from, to: edit.to + 1, insert: edit.insert },
    selection: EditorSelection.cursor(edit.cursor),
    userEvent: 'input.type.smart',
    annotations: isolateHistory.of('before'),
  });
  return true;
}));
