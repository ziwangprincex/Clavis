import { describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { LanguageDescription, ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { alignColumn, columnAlign, deleteColumn, deleteRow, deleteTable, formatTable, imageMarkdown, insertColumn, insertColumnLeft, insertLink, insertRow, insertRowAbove, markdownEditing, moveCell, moveColumn, moveRow, pasteImages, removeHeadingMark, setHeading, shiftHeading, tableSource, toggleMark } from './markdownEditing';
import { codeLanguages } from './codeLanguages';
import { frontmatterLength } from './markdownFrontmatter';
import { currentBlockLines } from './focusBlock';
import { markdownLanguage } from './controller';
import { markdownHeadings } from '../render/markdown';
import { findTodos } from '../writing/todos';

/** Commands only read `state` and call `dispatch`. */
function run(command: (view: EditorView) => boolean, doc: string, anchor: number, head = anchor) {
  let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: markdownLanguage() });
  ensureSyntaxTree(state, doc.length, 5000);
  const view = { get state() { return state; }, dispatch: (...specs: TransactionSpec[]) => { state = state.update(...specs).state; } };
  command(view as unknown as EditorView);
  const { from, to } = state.selection.main;
  return { doc: state.doc.toString(), selected: state.sliceDoc(from, to), head: state.selection.main.head };
}

describe('Typora formatting commands', () => {
  it('wraps a selection in a mark and unwraps it again', () => {
    expect(run(toggleMark('**'), 'make bold now', 5, 9)).toMatchObject({ doc: 'make **bold** now', selected: 'bold' });
    expect(run(toggleMark('**'), 'make **bold** now', 7, 11)).toMatchObject({ doc: 'make bold now', selected: 'bold' });
    expect(run(toggleMark('**'), 'make **bold** now', 5, 13)).toMatchObject({ doc: 'make bold now', selected: 'bold' });
    // Italic inside bold adds a star rather than stripping one of the bold pair.
    expect(run(toggleMark('*'), '**bold**', 2, 6).doc).toBe('***bold***');
    expect(run(toggleMark('**'), 'ab', 1).doc).toBe('a****b');
  });

  it('builds links around text or a URL', () => {
    expect(run(insertLink, 'see docs here', 4, 8)).toMatchObject({ doc: 'see [docs]() here', head: 11 });
    expect(run(insertLink, 'https://typora.io', 0, 17)).toMatchObject({ doc: '[](https://typora.io)', head: 1 });
  });

  it('sets, toggles and shifts heading levels, keeping quote markers', () => {
    expect(run(setHeading(2), 'Title', 0).doc).toBe('## Title');
    expect(run(setHeading(2), '## Title', 4).doc).toBe('Title');
    expect(run(setHeading(1), '### Title', 4).doc).toBe('# Title');
    expect(run(setHeading(0), '### Title', 4).doc).toBe('Title');
    expect(run(setHeading(3), '> quoted', 3).doc).toBe('> ### quoted');
    expect(run(shiftHeading(-1), '### Title', 5).doc).toBe('## Title');
    expect(run(shiftHeading(-1), '# Title', 3).doc).toBe('# Title');
    expect(run(shiftHeading(-1), 'Title', 0).doc).toBe('###### Title');
    expect(run(shiftHeading(1), '###### Title', 8).doc).toBe('Title');
    expect(run(shiftHeading(1), 'Title', 0).doc).toBe('Title');
  });
});

describe('fixes after 1.8.0', () => {
  it('leaves the line after a triple-clicked one alone and blank lines blank', () => {
    expect(run(setHeading(2), 'One\nTwo\n', 0, 4).doc).toBe('## One\nTwo\n');
    expect(run(setHeading(2), 'A\n\nB', 0, 4).doc).toBe('## A\n\n## B');
    expect(run(setHeading(2), '\nB', 0).doc).toBe('## \nB');
    // Toggles off only when every selected line already has the level.
    expect(run(setHeading(2), '## A\nB', 0, 6).doc).toBe('## A\n## B');
    expect(run(setHeading(2), '## A\n## B', 0, 9).doc).toBe('A\nB');
  });

  it('reads heading levels after quote markers', () => {
    expect(run(shiftHeading(-1), '> ## Title', 6).doc).toBe('> # Title');
    expect(run(shiftHeading(1), '> ## Title', 6).doc).toBe('> ### Title');
    expect(run(removeHeadingMark, '> ## Title', 5).doc).toBe('> Title');
    expect(run(removeHeadingMark, '## Title', 2).doc).toBe('## Title');
  });

  it('keeps quote markers and indentation when formatting or extending a table', () => {
    const quoted = '> | a | b |\n> |---|---|\n> | 1 | 2 |\n';
    expect(run(formatTable, quoted, 4).doc).toBe('> | a   | b   |\n> | --- | --- |\n> | 1   | 2   |\n');
    const added = run(moveCell(1), quoted, quoted.indexOf('2 |'));
    expect(added.doc).toBe('> | a | b |\n> |---|---|\n> | 1 | 2 |\n> |  |  |\n');
    expect(added.head).toBe(added.doc.indexOf('> |  |') + 4);
    expect(run(moveCell(1), quoted, 2).head).toBe(quoted.indexOf('a |'));
    const listed = '- item\n\n  | a |\n  |---|\n  | 1 |\n';
    expect(run(insertRow, listed, listed.indexOf('1 |')).doc).toBe('- item\n\n  | a |\n  |---|\n  | 1 |\n  |  |\n');
  });

  it('escapes the characters that would break an image link', () => {
    expect(imageMarkdown('assets/100% done (v2) #1?.png')).toBe('![](assets/100%25%20done%20%28v2%29%20%231%3F.png)');
    expect(imageMarkdown('图/截图.png')).toBe('![](图/截图.png)');
  });

  it('does not link a pasted image into a document opened while it was saved', async () => {
    let state = EditorState.create({ doc: 'a', extensions: markdownEditing() });
    const view = { get state() { return state; }, dispatch: (spec: TransactionSpec) => { state = state.update(spec).state; }, dom: { isConnected: true } };
    const notice = vi.fn();
    let release!: (path: string) => void;
    const pending = pasteImages(view as never, { pasteImage: () => new Promise(done => { release = done; }), notice }, [new File([], 'x.png')]);
    // Another document is shown before the save finishes.
    state = EditorState.create({ doc: 'other', extensions: markdownEditing() });
    release('assets/x.png');
    await pending;
    expect(state.doc.toString()).toBe('other');
    expect(notice).toHaveBeenCalledOnce();
    // The same document gets its link.
    const same = pasteImages(view as never, { pasteImage: async () => 'assets/y.png', notice }, [new File([], 'y.png')]);
    await same;
    expect(state.doc.toString()).toBe('![](assets/y.png)other');
  });
});

describe('table editing', () => {
  const table = '| 功能 | b |\n|:--|--:|\n| 实时 | 2 |\n\nafter';

  it('formats the table at the cursor with CJK counted double, keeping alignment', () => {
    expect(run(formatTable, table, 3).doc).toBe('| 功能 |   b |\n| :--- | --: |\n| 实时 |   2 |\n\nafter');
    expect(run(formatTable, 'plain text', 2).doc).toBe('plain text');
  });

  it('moves between cells with Tab and adds a row past the last one', () => {
    expect(run(moveCell(1), table, 2).head).toBe(table.indexOf('b |'));
    expect(run(moveCell(1), table, table.indexOf('b |')).head).toBe(table.indexOf('实时'));
    expect(run(moveCell(-1), table, table.indexOf('实时') + 1).head).toBe(table.indexOf('b |'));
    const added = run(moveCell(1), table, table.indexOf('2 |'));
    expect(added.doc).toBe('| 功能 | b |\n|:--|--:|\n| 实时 | 2 |\n|  |  |\n\nafter');
    expect(added.head).toBe(added.doc.indexOf('|  |  |') + 2);
    expect(run(insertRow, table, 2).doc).toBe('| 功能 | b |\n|:--|--:|\n|  |  |\n| 实时 | 2 |\n\nafter');
    expect(run(moveCell(1), 'not a table', 2).doc).toBe('not a table');
  });
});

describe('table toolbar commands', () => {
  const table = '| a | b |\n|:--|---|\n| 1 | 2 |\n| 3 | 4 |\n';
  const inB = table.indexOf('b |');

  it('aligns the cursor column through the delimiter row only, toggling off on repeat', () => {
    const right = run(alignColumn('right'), table, inB);
    expect(right.doc).toBe('| a | b |\n| :-- | ---: |\n| 1 | 2 |\n| 3 | 4 |\n');
    expect(run(alignColumn('right'), right.doc, inB).doc).toBe('| a | b |\n| :-- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
    const state = EditorState.create({ doc: table, selection: { anchor: 2 }, extensions: markdownLanguage() });
    ensureSyntaxTree(state, table.length, 5000);
    expect(columnAlign(state)).toBe('left');
  });

  it('inserts and deletes columns in every row, keeping blockquote markers', () => {
    const added = run(insertColumn, table, inB);
    expect(added.doc).toBe('| a | b |  |\n| :-- | --- | --- |\n| 1 | 2 |  |\n| 3 | 4 |  |\n');
    expect(added.head).toBe(added.doc.indexOf('|  |') + 2);
    expect(run(deleteColumn, table, inB).doc).toBe('| a |\n| :-- |\n| 1 |\n| 3 |\n');
    expect(run(deleteColumn, '| a |\n|---|\n| 1 |\n', 2).doc).toBe('| a |\n|---|\n| 1 |\n');
    const quoted = '> | a | b |\n> |---|---|\n> | 1 | 2 |\n';
    expect(run(deleteColumn, quoted, quoted.indexOf('b')).doc).toBe('> | a |\n> | --- |\n> | 1 |\n');
  });

  it('deletes body rows but never the header or delimiter', () => {
    expect(run(deleteRow, table, table.indexOf('3 |')).doc).toBe('| a | b |\n|:--|---|\n| 1 | 2 |\n');
    expect(run(deleteRow, table, 2).doc).toBe(table);
  });

  it('inserts above and to the left, as Typora\'s table menu does', () => {
    const above = run(insertRowAbove, table, table.indexOf('3 |'));
    expect(above.doc).toBe('| a | b |\n| :-- | --- |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |\n');
    expect(above.head).toBe(above.doc.indexOf('|  |  |') + 2);
    // From the header the new row becomes the first body row.
    expect(run(insertRowAbove, table, 2).doc).toBe('| a | b |\n| :-- | --- |\n|  |  |\n| 1 | 2 |\n| 3 | 4 |\n');
    expect(run(insertColumnLeft, table, inB).doc).toBe('| a |  | b |\n| :-- | --- | --- |\n| 1 |  | 2 |\n| 3 |  | 4 |\n');
  });

  it('moves rows within the body and columns with their alignment', () => {
    const down = run(moveRow(1), table, table.indexOf('1 |'));
    expect(down.doc).toBe('| a | b |\n| :-- | --- |\n| 3 | 4 |\n| 1 | 2 |\n');
    expect(down.head).toBe(down.doc.indexOf('1 |'));
    // The first body row cannot move above the header; the last cannot move further down.
    expect(run(moveRow(-1), table, table.indexOf('1 |')).doc).toBe(table);
    expect(run(moveRow(1), table, table.indexOf('3 |')).doc).toBe(table);
    expect(run(moveRow(-1), table, 2).doc).toBe(table);
    const right = run(moveColumn(1), table, 2);
    expect(right.doc).toBe('| b | a |\n| --- | :-- |\n| 2 | 1 |\n| 4 | 3 |\n');
    expect(right.head).toBe(right.doc.indexOf('a |'));
    expect(run(moveColumn(1), table, inB).doc).toBe(table);
    const quoted = '> | a |\n> |---|\n> | 1 |\n> | 2 |\n';
    expect(run(moveRow(1), quoted, quoted.indexOf('1 |')).doc).toBe('> | a |\n> | --- |\n> | 2 |\n> | 1 |\n');
  });

  it('copies and deletes the whole table', () => {
    const quoted = '> | a |\n> |---|\n> | 1 |';
    const state = EditorState.create({ doc: quoted, selection: { anchor: 4 }, extensions: markdownLanguage() });
    ensureSyntaxTree(state, quoted.length, 5000);
    expect(tableSource(state)).toBe('| a |\n| --- |\n| 1 |');
    expect(run(deleteTable, `Before\n\n${table}\nAfter`, 10).doc).toBe('Before\n\nAfter');
    expect(run(deleteTable, `Before\n\n${table.trimEnd()}`, 10).doc).toBe('Before\n');
  });
});

describe('Markdown parser additions', () => {
  const tree = (doc: string) => {
    const state = EditorState.create({ doc, extensions: markdownLanguage() });
    ensureSyntaxTree(state, doc.length, 5000);
    const names: string[] = [];
    syntaxTree(state).iterate({ enter: node => { names.push(node.name); } });
    return names;
  };

  it('reads YAML front matter as metadata, not a rule and a heading', () => {
    const doc = '---\ntitle: Draft\ntags: [a]\n---\n\n# Real heading\n';
    expect(tree(doc)).toContain('Frontmatter');
    expect(tree(doc)).not.toContain('SetextHeading2');
    expect(markdownHeadings(doc).map(item => [item.title, item.line])).toEqual([['Real heading', 6]]);
    expect(frontmatterLength(doc)).toBe('---\ntitle: Draft\ntags: [a]\n---\n'.length);
  });

  it('ends unclosed front matter at the first line that is not YAML', () => {
    const doc = '---\nNote: written in a hurry\n\nA paragraph with **bold**.\n';
    expect(tree(doc)).toContain('StrongEmphasis');
    expect(frontmatterLength(doc)).toBe('---\nNote: written in a hurry\n\n'.length);
  });

  it('leaves a document that merely starts with a rule alone', () => {
    expect(tree('---\nSome prose.\n')).not.toContain('Frontmatter');
    expect(frontmatterLength('---\nSome prose.\n')).toBe(0);
  });

  it('recognizes bare web addresses as links, as Typora does', () => {
    expect(tree('See https://typora.io and www.example.org today.')).toEqual(expect.arrayContaining(['URL']));
    expect(tree('See https://typora.io today.').filter(name => name === 'URL')).toHaveLength(1);
  });

  it('knows the common fence languages by name and alias', () => {
    for (const name of ['python', 'py', 'bash', 'ts', 'c++', 'yaml', 'latex', 'r']) {
      expect(LanguageDescription.matchLanguageName(codeLanguages, name), name).toBeTruthy();
    }
  });
});

describe('focus and to-dos', () => {
  it('finds the paragraph around the cursor', () => {
    const doc = 'one\n\ntwo\nthree\n\nfour';
    const lines = (pos: number) => currentBlockLines(EditorState.create({ doc, selection: { anchor: pos } }));
    expect(lines(doc.indexOf('three'))).toEqual({ first: 3, last: 4 });
    expect(lines(0)).toEqual({ first: 1, last: 1 });
    expect(lines(doc.indexOf('\n\nfour') + 1)).toEqual({ first: 5, last: 5 });
  });

  it('skips to-dos that are switched off, in URLs or shown as code', () => {
    expect(findTodos('% \\todo{off}\n\\todo{on} % TODO: also', 'latex')).toEqual([{ line: 2, text: 'also' }]);
    expect(findTodos('#link("https://todo.example")\n// TODO real', 'typst')).toEqual([{ line: 2, text: 'real' }]);
    expect(findTodos('```html\n<!-- TODO: example -->\n```\n<!-- TODO: real -->', 'markdown')).toEqual([{ line: 4, text: 'real' }]);
  });

  it('collects to-do notes per language', () => {
    expect(findTodos('Text % TODO: cite this\n\\todo[inline]{check figure}\n50\\% done % fixme later', 'latex'))
      .toEqual([{ line: 1, text: 'cite this' }, { line: 2, text: 'check figure' }, { line: 3, text: 'later' }]);
    expect(findTodos('= Intro\n// TODO tighten\nhttps://example.org', 'typst')).toEqual([{ line: 2, text: 'tighten' }]);
    expect(findTodos('Body\n<!-- TODO: add data -->\n<!-- note -->', 'markdown')).toEqual([{ line: 2, text: 'add data' }]);
  });
});
