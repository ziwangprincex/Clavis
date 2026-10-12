import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { LanguageDescription, ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { alignColumn, columnAlign, deleteColumn, deleteRow, formatTable, insertColumn, insertLink, insertRow, moveCell, setHeading, shiftHeading, toggleMark } from './markdownEditing';
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

  it('leaves a document that merely starts with a rule alone', () => {
    expect(tree('---\nSome prose.\n')).not.toContain('Frontmatter');
    expect(frontmatterLength('---\nSome prose.\n')).toBe(0);
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

  it('collects to-do notes per language', () => {
    expect(findTodos('Text % TODO: cite this\n\\todo[inline]{check figure}\n50\\% done % fixme later', 'latex'))
      .toEqual([{ line: 1, text: 'cite this' }, { line: 2, text: 'check figure' }, { line: 3, text: 'later' }]);
    expect(findTodos('= Intro\n// TODO tighten\nhttps://example.org', 'typst')).toEqual([{ line: 2, text: 'tighten' }]);
    expect(findTodos('Body\n<!-- TODO: add data -->\n<!-- note -->', 'markdown')).toEqual([{ line: 2, text: 'add data' }]);
  });
});
