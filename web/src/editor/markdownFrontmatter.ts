// YAML front matter at the top of a Markdown document. Without this rule the
// opening `---` parses as a rule and `title: x` + `---` as a setext heading,
// which also put the metadata into the outline.

import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown';
import { styleTags, tags } from '@lezer/highlight';

const FENCE = /^---[ \t]*$/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
/** The line after the fence must look like YAML, so a document that starts with a plain rule is unaffected. */
const KEY = /^[\w"'-][^:\n]*:(?:\s|$)/;

function parse(cx: BlockContext, line: Line): boolean {
  // Only the document's very first line; inside a quote or list the text would carry their markers.
  if (cx.lineStart !== 0 || !FENCE.test(line.text) || !KEY.test(cx.peekLine())) return false;
  const marks = [cx.elt('FrontmatterMark', 0, line.text.length)];
  let to = cx.prevLineEnd();
  // An unclosed block runs to the end, as while it is being typed.
  while (cx.nextLine()) {
    to = cx.lineStart + line.text.length;
    if (CLOSE.test(line.text)) {
      marks.push(cx.elt('FrontmatterMark', cx.lineStart, to));
      cx.nextLine();
      break;
    }
  }
  cx.addElement(cx.elt('Frontmatter', 0, Math.max(to, line.text.length), marks));
  return true;
}

export const markdownFrontmatter: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true }, 'FrontmatterMark'],
  props: [styleTags({ FrontmatterMark: tags.processingInstruction })],
  parseBlock: [{ name: 'Frontmatter', parse, before: 'HorizontalRule' }],
};

/** The same front matter as text, for parsers that do not know it (the outline). */
export function frontmatterLength(source: string): number {
  const lines = source.split('\n');
  if (!FENCE.test(lines[0] ?? '') || !KEY.test(lines[1] ?? '')) return 0;
  let length = lines[0].length + 1;
  for (let i = 1; i < lines.length; i++) {
    length += lines[i].length + 1;
    if (CLOSE.test(lines[i])) return Math.min(length, source.length);
  }
  return source.length;
}
