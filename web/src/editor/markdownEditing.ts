// Typora-style Markdown editing commands: formatting shortcuts, wrapping a
// selection by typing a mark, and pasting images. They work in formatted and
// source mode alike and only edit the plain Markdown text.

import { completionStatus, hasNextSnippetField } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, Prec, type ChangeSpec, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type Command } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

export interface MarkdownImageHost {
  /** Save pasted image data beside the document; the relative path, or null. */
  pasteImage(file: File): Promise<string | null>;
}

/** Wrap each selection in `mark`, or unwrap it if it is already wrapped. */
export function toggleMark(mark: string): Command {
  return view => {
    const { state } = view;
    const n = mark.length;
    view.dispatch(state.changeByRange(range => {
      const inner = state.sliceDoc(range.from, range.to);
      const before = state.sliceDoc(range.from - n, range.from);
      const after = state.sliceDoc(range.to, range.to + n);
      // `**bold**` selected with its marks, or just the text between them.
      if (inner.length >= 2 * n && inner.startsWith(mark) && inner.endsWith(mark)) {
        return {
          changes: [{ from: range.from, to: range.from + n }, { from: range.to - n, to: range.to }],
          range: EditorSelection.range(range.from, range.to - 2 * n),
        };
      }
      if (before === mark && after === mark && !(mark === '*' && isBold(state.sliceDoc(range.from - 2, range.to + 2)))) {
        return {
          changes: [{ from: range.from - n, to: range.from }, { from: range.to, to: range.to + n }],
          range: EditorSelection.range(range.from - n, range.to - n),
        };
      }
      return {
        changes: [{ from: range.from, insert: mark }, { from: range.to, insert: mark }],
        range: EditorSelection.range(range.from + n, range.to + n),
      };
    }));
    return true;
  };
}

/** Italic's `*` must not unwrap one star of a bold `**…**`. */
function isBold(text: string): boolean {
  return text.startsWith('**') && text.endsWith('**');
}

/** `[text](|)`, or `[|](url)` when the selection is a URL. */
export const insertLink: Command = view => {
  view.dispatch(view.state.changeByRange(range => {
    const text = view.state.sliceDoc(range.from, range.to);
    if (/^(?:https?:\/\/|mailto:|www\.)\S+$/i.test(text)) {
      return { changes: { from: range.from, to: range.to, insert: `[](${text})` }, range: EditorSelection.cursor(range.from + 1) };
    }
    const insert = `[${text}]()`;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length - 1) };
  }));
  return true;
};

/** Make the selected lines headings of `level` (0 = paragraph); the same level again turns them back into paragraphs. */
export function setHeading(level: number, toggle = true): Command {
  return view => {
    const { state } = view;
    const changes: ChangeSpec[] = [];
    const seen = new Set<number>();
    for (const range of state.selection.ranges) {
      for (let pos = range.from; pos <= range.to;) {
        const line = state.doc.lineAt(pos);
        if (!seen.has(line.number)) {
          seen.add(line.number);
          // Keep blockquote markers in front of the heading.
          const quote = /^(?:\s{0,3}>\s?)*/.exec(line.text)![0];
          const current = /^(#{1,6})(?:[ \t]+|$)/.exec(line.text.slice(quote.length));
          const target = toggle && current && current[1].length === level ? 0 : level;
          const prefix = target ? `${'#'.repeat(target)} ` : '';
          const from = line.from + quote.length;
          changes.push({ from, to: from + (current?.[0].length ?? 0), insert: prefix });
        }
        pos = line.to + 1;
      }
    }
    view.dispatch({ changes, userEvent: 'input.format' });
    return true;
  };
}

/** Raise (`step` -1) or lower (+1) the cursor line's heading level. A raised
 *  paragraph becomes `######`; a lowered `######` becomes a paragraph again. */
export function shiftHeading(step: number): Command {
  return view => {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const current = /^(#{1,6})(?:[ \t]|$)/.exec(line.text)?.[1].length ?? 0;
    const next = current ? current + step : step < 0 ? 6 : 0;
    return setHeading(next > 6 ? 0 : Math.max(next, current ? 1 : 0), false)(view);
  };
}

/** Backspace right after a heading's hidden `## ` turns it back into a paragraph. */
const removeHeadingMark: Command = view => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  const mark = /^#{1,6}[ \t]+/.exec(line.text);
  if (!mark || range.head !== line.from + mark[0].length) return false;
  view.dispatch({ changes: { from: line.from, to: range.head }, userEvent: 'delete.backward' });
  return true;
};

// ---- Tables (Typora: Tab between cells, Cmd+Enter adds a row, Format Table Source) ----

/** The GFM table around `pos`, as its first and last line numbers. */
function tableAt(state: EditorState, pos: number): { first: number; last: number } | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === 'Table') return { first: state.doc.lineAt(node.from).number, last: state.doc.lineAt(node.to).number };
  }
  return null;
}

/** Offsets of the unescaped pipes in a row. */
function pipes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '|') out.push(i);
  }
  return out;
}

function cells(text: string): string[] {
  const edges = pipes(text);
  const trimmed = text.trim();
  const bounds = [...(trimmed.startsWith('|') ? [] : [-1]), ...edges, ...(trimmed.endsWith('|') && edges.length ? [] : [text.length])];
  const out: string[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) out.push(text.slice(bounds[i] + 1, bounds[i + 1]).trim());
  return out;
}

/** Where each cell's text starts on a row, as document positions. */
function cellStarts(state: EditorState, lineNumber: number): number[] {
  const line = state.doc.line(lineNumber);
  const edges = pipes(line.text);
  const starts = line.text.trimStart().startsWith('|') ? [] : [line.from + line.text.length - line.text.trimStart().length];
  for (const at of edges.slice(0, line.text.trimEnd().endsWith('|') ? -1 : undefined)) {
    starts.push(line.from + at + 1 + (line.text[at + 1] === ' ' ? 1 : 0));
  }
  return starts;
}

const emptyRow = (columns: number) => `| ${Array.from({ length: columns }, () => '').join(' | ')} |`;

/** Moves between cells; Tab past the last cell adds a row, like Typora. */
export function moveCell(dir: 1 | -1): Command {
  return view => {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty || completionStatus(state) === 'active' || hasNextSnippetField(state)) return false;
    const table = tableAt(state, range.head);
    if (!table) return false;
    const starts: number[] = [];
    for (let n = table.first; n <= table.last; n++) if (n !== table.first + 1) starts.push(...cellStarts(state, n));
    const current = [...starts].reverse().find(pos => pos <= range.head) ?? -1;
    const target = dir > 0 ? starts.find(pos => pos > range.head) : [...starts].reverse().find(pos => pos < current);
    if (target !== undefined) {
      view.dispatch({ selection: { anchor: target }, scrollIntoView: true, userEvent: 'select' });
    } else if (dir > 0) {
      const last = state.doc.line(table.last);
      const insert = `\n${emptyRow(cells(state.doc.line(table.first).text).length)}`;
      view.dispatch({ changes: { from: last.to, insert }, selection: { anchor: last.to + 3 }, scrollIntoView: true, userEvent: 'input' });
    }
    return true;
  };
}

/** A new empty row below the cursor's row (below the delimiter on the header). */
export const insertRow: Command = view => {
  const { state } = view;
  const table = tableAt(state, state.selection.main.head);
  if (!table) return false;
  const lineNumber = Math.max(state.doc.lineAt(state.selection.main.head).number, table.first + 1);
  const line = state.doc.line(lineNumber);
  const insert = `\n${emptyRow(cells(state.doc.line(table.first).text).length)}`;
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + 3 }, scrollIntoView: true, userEvent: 'input' });
  return true;
};

/** Columns in a monospace font: CJK and full-width characters take two. */
function width(text: string): number {
  let n = 0;
  for (const ch of text) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(ch) ? 2 : 1;
  return n;
}

/** Typora's "Format Table Source": pads cells so the pipes line up. Run on request only. */
export const formatTable: Command = view => {
  const { state } = view;
  const table = tableAt(state, state.selection.main.head);
  if (!table) return false;
  const rows: string[][] = [];
  for (let n = table.first; n <= table.last; n++) rows.push(cells(state.doc.line(n).text));
  const columns = Math.max(...rows.map(row => row.length));
  const align = Array.from({ length: columns }, (_, i) => {
    const spec = rows[1]?.[i] ?? '';
    return spec.startsWith(':') && spec.endsWith(':') ? 'center' : spec.endsWith(':') ? 'right' : spec.startsWith(':') ? 'left' : '';
  });
  const widths = Array.from({ length: columns }, (_, i) => Math.max(3, ...rows.filter((_, r) => r !== 1).map(row => width(row[i] ?? ''))));
  const pad = (text: string, i: number) => {
    const space = widths[i] - width(text);
    if (align[i] === 'right') return ' '.repeat(space) + text;
    if (align[i] === 'center') return ' '.repeat(Math.floor(space / 2)) + text + ' '.repeat(Math.ceil(space / 2));
    return text + ' '.repeat(space);
  };
  const rule = (i: number) => {
    const dashes = '-'.repeat(widths[i] - (align[i] === 'center' ? 2 : align[i] ? 1 : 0));
    return align[i] === 'center' ? `:${dashes}:` : align[i] === 'right' ? `${dashes}:` : align[i] === 'left' ? `:${dashes}` : dashes;
  };
  const text = rows.map((row, r) => `| ${Array.from({ length: columns }, (_, i) => r === 1 ? rule(i) : pad(row[i] ?? '', i)).join(' | ')} |`).join('\n');
  const from = state.doc.line(table.first).from, to = state.doc.line(table.last).to;
  if (text !== state.sliceDoc(from, to)) view.dispatch({ changes: { from, to, insert: text }, userEvent: 'input.format' });
  return true;
};

// ---- Table structure, for the table toolbar (Typora's table menu) ----

export type ColumnAlign = 'left' | 'center' | 'right' | '';

const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)*/;

/** The table at the cursor as rows of cells (blockquote markers kept aside),
 *  with the cursor's row and column. */
function tableRows(state: EditorState) {
  const head = state.selection.main.head;
  const table = tableAt(state, head);
  if (!table) return null;
  const rows: { prefix: string; cells: string[] }[] = [];
  for (let n = table.first; n <= table.last; n++) {
    const text = state.doc.line(n).text;
    const prefix = QUOTE_PREFIX.exec(text)![0];
    rows.push({ prefix, cells: cells(text.slice(prefix.length)) });
  }
  const line = state.doc.lineAt(head);
  const row = line.number - table.first;
  const body = line.text.slice(rows[row].prefix.length);
  const offset = head - line.from - rows[row].prefix.length;
  const columns = Math.max(...rows.map(r => r.cells.length));
  const before = pipes(body).filter(at => at < offset).length - (body.trimStart().startsWith('|') ? 1 : 0);
  return { table, rows, row, column: Math.max(0, Math.min(columns - 1, before)), columns };
}

const alignOf = (spec: string): ColumnAlign =>
  spec.startsWith(':') && spec.endsWith(':') ? 'center' : spec.endsWith(':') ? 'right' : spec.startsWith(':') ? 'left' : '';

/** The alignment of the column holding the cursor, or null outside a table. */
export function columnAlign(state: EditorState): ColumnAlign | null {
  const info = tableRows(state);
  return info ? alignOf(info.rows[1]?.cells[info.column] ?? '') : null;
}

const rowText = (row: { prefix: string; cells: string[] }) => `${row.prefix}| ${row.cells.join(' | ')} |`;

/** Replaces the table with `rows`, the cursor at the start of cell (`row`, `column`). */
function writeTable(view: EditorView, table: { first: number; last: number }, rows: { prefix: string; cells: string[] }[], row: number, column: number) {
  const { doc } = view.state;
  const from = doc.line(table.first).from, to = doc.line(table.last).to;
  const lines = rows.map(rowText);
  const target = rows[row];
  const anchor = from + lines.slice(0, row).reduce((n, line) => n + line.length + 1, 0)
    + target.prefix.length + 2 + target.cells.slice(0, column).reduce((n, cell) => n + cell.length + 3, 0);
  view.dispatch({ changes: { from, to, insert: lines.join('\n') }, selection: { anchor }, userEvent: 'input' });
}

/** Sets the cursor column's alignment; only the delimiter row changes. */
export function alignColumn(align: ColumnAlign): Command {
  return view => {
    const info = tableRows(view.state);
    if (!info || !info.rows[1]) return false;
    const delimiter = info.rows[1];
    const cellsNow = [...delimiter.cells];
    while (cellsNow.length < info.columns) cellsNow.push('---');
    const dashes = cellsNow[info.column].replace(/:/g, '') || '---';
    // The same alignment again clears it, as a toggle.
    const next = alignOf(cellsNow[info.column]) === align ? '' : align;
    cellsNow[info.column] = next === 'center' ? `:${dashes}:` : next === 'right' ? `${dashes}:` : next === 'left' ? `:${dashes}` : dashes;
    const line = view.state.doc.line(info.table.first + 1);
    view.dispatch({ changes: { from: line.from, to: line.to, insert: rowText({ ...delimiter, cells: cellsNow }) }, userEvent: 'input' });
    return true;
  };
}

/** An empty column right of the cursor's column. */
export const insertColumn: Command = view => {
  const info = tableRows(view.state);
  if (!info) return false;
  const rows = info.rows.map((row, r) => ({ ...row, cells: [...row.cells.slice(0, info.column + 1), r === 1 ? '---' : '', ...row.cells.slice(info.column + 1)] }));
  writeTable(view, info.table, rows, info.row === 1 ? 0 : info.row, info.column + 1);
  return true;
};

/** Removes the cursor's column; a table keeps at least one. */
export const deleteColumn: Command = view => {
  const info = tableRows(view.state);
  if (!info || info.columns < 2) return false;
  const rows = info.rows.map(row => ({ ...row, cells: row.cells.filter((_, i) => i !== info.column) }));
  writeTable(view, info.table, rows, info.row === 1 ? 0 : info.row, Math.min(info.column, info.columns - 2));
  return true;
};

/** Removes the cursor's body row; the header and delimiter rows stay. */
export const deleteRow: Command = view => {
  const info = tableRows(view.state);
  if (!info || info.row < 2) return false;
  const line = view.state.doc.line(info.table.first + info.row);
  const previous = view.state.doc.line(line.number - 1);
  view.dispatch({ changes: { from: previous.to, to: line.to }, selection: { anchor: previous.number > info.table.first + 1 ? previous.from + previous.text.indexOf('|') + 2 : previous.to }, userEvent: 'delete' });
  return true;
};

/** Typing one of these over a selection wraps it instead of replacing it;
 *  `=` twice makes a ==highlight==, as in Typora. */
const WRAPPING = new Set(['*', '_', '`', '$', '=', '^', '~']);

async function pasteImages(view: EditorView, host: MarkdownImageHost, files: File[]) {
  const links: string[] = [];
  for (const file of files) {
    const path = await host.pasteImage(file);
    if (path) links.push(`![](${/\s/.test(path) ? `<${path}>` : path})`);
  }
  if (!links.length || !view.dom.isConnected) return;
  const insert = links.join('\n');
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.paste' });
}

export function markdownEditing(host?: MarkdownImageHost): Extension {
  return [
    // Above the default keymap, whose Mod-i selects the parent syntax node.
    Prec.high(keymap.of([
      // Typora's Format and Paragraph menus.
      { key: 'Mod-b', run: toggleMark('**') },
      { key: 'Mod-i', run: toggleMark('*') },
      { key: 'Ctrl-`', run: toggleMark('`') },
      { key: 'Ctrl-Shift-`', run: toggleMark('~~') },
      { key: 'Mod-k', run: insertLink },
      ...[0, 1, 2, 3, 4, 5, 6].map(level => ({ key: `Mod-${level}`, run: setHeading(level) })),
      { key: 'Mod-=', run: shiftHeading(-1) },
      { key: 'Mod--', run: shiftHeading(1) },
      { key: 'Backspace', run: removeHeadingMark },
      { key: 'Tab', run: moveCell(1), shift: moveCell(-1) },
      { key: 'Mod-Enter', run: insertRow },
    ])),
    EditorView.inputHandler.of((view, _from, _to, text) => {
      if (!WRAPPING.has(text) || view.state.selection.ranges.some(range => range.empty)) return false;
      view.dispatch({
        ...view.state.changeByRange(range => ({
          changes: [{ from: range.from, insert: text }, { from: range.to, insert: text }],
          range: EditorSelection.range(range.from + 1, range.to + 1),
        })),
        userEvent: 'input.type',
      });
      return true;
    }),
    host ? EditorView.domEventHandlers({
      paste(event, view) {
        const files = [...event.clipboardData?.files ?? []].filter(file => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        void pasteImages(view, host, files);
        return true;
      },
    }) : [],
  ];
}
