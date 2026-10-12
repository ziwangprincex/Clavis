// Markdown math syntax for the editor's parser. The rules mirror the preview
// tokenizer in render/markdown.ts, so `$…$`, `$$…$$` and `$$` blocks are
// recognized the same way, and emphasis inside formulas is never parsed.

import type { BlockContext, Element, Line, MarkdownConfig } from '@lezer/markdown';
import { styleTags, tags } from '@lezer/highlight';

const DOLLAR = 36;
const INLINE_DISPLAY = /^\$\$([^\n]+?)\$\$/;
const INLINE = /^\$(?!\$)([^\s$](?:[^\n$]*?[^\s\\$])?)\$(?!\d)/;

function opensBlock(line: Line): boolean {
  if (line.next !== DOLLAR || line.text.charCodeAt(line.pos + 1) !== DOLLAR) return false;
  const close = line.text.indexOf('$$', line.pos + 2);
  // `$$x$$ more text` is an inline formula inside a paragraph.
  return close < 0 || (close > line.pos + 2 && !line.text.slice(close + 2).trim());
}

function parseBlock(cx: BlockContext, line: Line): boolean {
  if (!opensBlock(line)) return false;
  const from = cx.lineStart + line.pos;
  const marks: Element[] = [cx.elt('DisplayMathMark', from, from + 2)];
  const sameLine = line.text.indexOf('$$', line.pos + 2);
  if (sameLine >= 0) {
    const to = cx.lineStart + sameLine + 2;
    marks.push(cx.elt('DisplayMathMark', to - 2, to));
    cx.nextLine();
    cx.addElement(cx.elt('DisplayMath', from, to, marks));
    return true;
  }
  // Like an unclosed code fence, an unclosed block runs to its container's end.
  // `depth` (containers matched on this line) and `markers` (their marks, e.g.
  // a blockquote's `>`) are what FencedCode uses; both exist at runtime but are
  // missing from the published typings.
  const inner = line as Line & { depth: number; markers: Element[] };
  let to = -1;
  while (cx.nextLine() && inner.depth >= cx.depth) {
    marks.push(...inner.markers);
    const at = line.text.indexOf('$$', line.pos);
    if (at >= 0 && !line.text.slice(at + 2).trim()) {
      to = cx.lineStart + at + 2;
      marks.push(cx.elt('DisplayMathMark', to - 2, to));
      cx.nextLine();
      break;
    }
  }
  cx.addElement(cx.elt('DisplayMath', from, to < 0 ? cx.prevLineEnd() : to, marks));
  return true;
}

export const markdownMath: MarkdownConfig = {
  defineNodes: [
    { name: 'DisplayMath', block: true },
    'DisplayMathMark',
    'InlineMath',
    'InlineMathMark',
  ],
  props: [styleTags({
    'DisplayMath InlineMath': tags.string,
    'DisplayMathMark InlineMathMark': tags.processingInstruction,
  })],
  parseBlock: [{
    name: 'DisplayMath',
    parse: parseBlock,
    endLeaf: (_cx, line) => opensBlock(line),
    before: 'FencedCode',
  }],
  parseInline: [{
    name: 'InlineMath',
    parse(cx, next, pos) {
      if (next !== DOLLAR) return -1;
      const rest = cx.slice(pos, cx.end);
      const match = INLINE_DISPLAY.exec(rest) ?? INLINE.exec(rest);
      if (!match) return -1;
      const mark = match[0].startsWith('$$') ? 2 : 1;
      const end = pos + match[0].length;
      return cx.addElement(cx.elt('InlineMath', pos, end, [
        cx.elt('InlineMathMark', pos, pos + mark),
        cx.elt('InlineMathMark', end - mark, end),
      ]));
    },
    before: 'Emphasis',
  }],
};
