// Footnotes, which GFM in the editor's parser leaves out: `[^id]` references
// and single-line `[^id]: text` definitions. Typora draws the reference as a
// superscript and the definition with a muted label.

import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown';
import { styleTags, tags } from '@lezer/highlight';

const REFERENCE = /^\[\^([^\]\s]+)\](?!:)/;
const DEFINITION = /^\[\^([^\]\s]+)\]:/;

function definition(line: Line) {
  return line.next === 91 /* [ */ ? DEFINITION.exec(line.text.slice(line.pos)) : null;
}

function parseDefinition(cx: BlockContext, line: Line): boolean {
  const match = definition(line);
  if (!match) return false;
  const from = cx.lineStart + line.pos;
  const markEnd = from + match[0].length;
  const end = cx.lineStart + line.text.length;
  const content = line.text.slice(line.pos + match[0].length);
  const children = [cx.elt('FootnoteMark', from, markEnd), ...cx.parser.parseInline(content, markEnd)];
  cx.nextLine();
  cx.addElement(cx.elt('FootnoteDefinition', from, end, children));
  return true;
}

export const markdownFootnotes: MarkdownConfig = {
  defineNodes: [{ name: 'FootnoteDefinition', block: true }, 'FootnoteReference', 'FootnoteMark', 'FootnoteLabel'],
  props: [styleTags({ FootnoteMark: tags.processingInstruction, FootnoteLabel: tags.labelName })],
  parseBlock: [{ name: 'FootnoteDefinition', parse: parseDefinition, endLeaf: (_cx, line) => !!definition(line) }],
  parseInline: [{
    name: 'FootnoteReference',
    parse(cx, next, pos) {
      if (next !== 91 || cx.char(pos + 1) !== 94 /* ^ */) return -1;
      const match = REFERENCE.exec(cx.slice(pos, cx.end));
      if (!match) return -1;
      const end = pos + match[0].length;
      return cx.addElement(cx.elt('FootnoteReference', pos, end, [
        cx.elt('FootnoteMark', pos, pos + 2),
        cx.elt('FootnoteLabel', pos + 2, end - 1),
        cx.elt('FootnoteMark', end - 1, end),
      ]));
    },
    before: 'Link',
  }],
};
