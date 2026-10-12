// Typora's extended inline syntax: ==highlight==, ^superscript^ and
// ~subscript~. Sub- and superscripts allow no spaces and no CJK text, so a
// Chinese range like "1~3天，5~7天" or "2^10 and 3^4" stays plain prose.
// render/markdown.ts applies the same rules to table cells.

import type { InlineContext, MarkdownConfig } from '@lezer/markdown';
import { styleTags, tags } from '@lezer/highlight';

/** Characters that end a sub- or superscript: whitespace and CJK text or punctuation. */
export const SCRIPT_STOP = /[\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;

const highlightDelimiter = { resolve: 'Highlight', mark: 'HighlightMark' };

function script(ch: number, node: string, mark: string) {
  return (cx: InlineContext, next: number, pos: number) => {
    if (next !== ch || cx.char(pos + 1) === ch || cx.char(pos - 1) === ch) return -1;
    for (let i = pos + 1; i < cx.end; i++) {
      const c = cx.char(i);
      if (c === ch) {
        if (i === pos + 1) return -1;
        return cx.addElement(cx.elt(node, pos, i + 1, [cx.elt(mark, pos, pos + 1), cx.elt(mark, i, i + 1)]));
      }
      if (c === 92 /* \ */) i++;
      else if (SCRIPT_STOP.test(String.fromCharCode(c))) return -1;
    }
    return -1;
  };
}

export const markdownInlineExtras: MarkdownConfig = {
  defineNodes: ['Highlight', 'HighlightMark', 'Superscript', 'SuperscriptMark', 'Subscript', 'SubscriptMark'],
  props: [styleTags({ 'HighlightMark SuperscriptMark SubscriptMark': tags.processingInstruction })],
  parseInline: [{
    name: 'Highlight',
    // Flanking rules as for GFM's ~~strikethrough~~.
    parse(cx, next, pos) {
      if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
      const before = cx.slice(pos - 1, pos), after = cx.slice(pos + 2, pos + 3);
      const spaceBefore = /^\s?$/.test(before), spaceAfter = /^\s?$/.test(after);
      const punctBefore = PUNCTUATION.test(before), punctAfter = PUNCTUATION.test(after);
      return cx.addDelimiter(highlightDelimiter, pos, pos + 2,
        !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
        !spaceBefore && (!punctBefore || spaceAfter || punctAfter));
    },
    after: 'Emphasis',
  }, {
    name: 'Superscript',
    parse: script(94 /* ^ */, 'Superscript', 'SuperscriptMark'),
  }, {
    name: 'Subscript',
    parse: script(126 /* ~ */, 'Subscript', 'SubscriptMark'),
    after: 'Strikethrough',
  }],
};
