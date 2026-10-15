import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdownLanguage } from './controller';
import { smartPunctuation } from './smartPunctuation';

/** Types `text` at the `§` in `doc` and applies the conversion, as the input handler does. */
function type(doc: string, text: string): string {
  const pos = doc.indexOf('§');
  const source = doc.replace('§', '');
  const state = EditorState.create({ doc: source, extensions: markdownLanguage() });
  ensureSyntaxTree(state, source.length, 5000);
  const edit = smartPunctuation(state, pos, text);
  const typed = source.slice(0, pos) + text + source.slice(pos);
  if (!edit) return typed.slice(0, pos + 1) + '§' + typed.slice(pos + 1);
  if (!edit.insert) return source.slice(0, edit.cursor) + '§' + source.slice(edit.cursor);
  const result = typed.slice(0, edit.from) + edit.insert + typed.slice(edit.to + 1);
  return result.slice(0, edit.cursor) + '§' + result.slice(edit.cursor);
}

describe('smart punctuation', () => {
  it('turns -- into an en dash and a third - into an em dash, inside text only', () => {
    expect(type('pages 10-§', '-')).toBe('pages 10–§');
    expect(type('wait–§', '-')).toBe('wait—§');
    expect(type('-§', '-')).toBe('--§');
    expect(type('| a |\n|-§', '-')).toBe('| a |\n|--§');
  });

  it('curls quotes and pairs an opening one', () => {
    expect(type('he said §', '"')).toBe('he said “§”');
    expect(type('he said “hi§”', '"')).toBe('he said “hi”§');
    expect(type('“hi§', '"')).toBe('“hi”§');
    expect(type('他说§', '"')).toBe('他说“§”');
    expect(type("don§", "'")).toBe('don’§');
    expect(type("say §", "'")).toBe('say ‘§');
  });

  it('leaves code, formulas and links as typed', () => {
    expect(type('`a -§`', '-')).toBe('`a --§`');
    expect(type('```\nx = "§\n```', '"')).toBe('```\nx = ""§\n```');
    expect(type('$a -§$', '-')).toBe('$a --§$');
  });
});
