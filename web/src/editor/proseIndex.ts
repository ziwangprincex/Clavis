import type { Text } from '@codemirror/state';
import type { Lang } from '../store/tabs';
import { nonProseRanges, type TextRange } from './writingSyntax';

type Line = { text: string; state: string; ranges: TextRange[] };
function scan(text: string, state: string, lang: Lang): Line {
  const ranges: TextRange[] = [];
  let start = 0;
  while (start < text.length) {
    if (state) {
      const end = text.indexOf(state, start);
      const to = end < 0 ? text.length : end + state.length;
      ranges.push({ from: start, to });
      start = to;
      if (end < 0) break;
      state = '';
    } else {
      const part = text.slice(start);
      const blank = (value: string) => ' '.repeat(value.length);
      const syntax = lang === 'latex' ? part : part.replace(/(?<!`)`(?!`)[^`]*`(?!`)/g, blank);
      const searchable = lang === 'typst' ? syntax.replace(/"(?:\\.|[^"\\])*"/g, blank) : syntax;
      const opening =
        lang === 'latex'
          ? /\\begin\{(verbatim\*?|lstlisting|minted|equation\*?|align\*?|gather\*?|multline\*?)\}|\\\[|\$\$|(?<!\\)\$/g
          : /`{3,}|~{3,}|\/\*|\$\$|(?<!\\)\$/g;
      const match = opening.exec(searchable);
      if (!match) {
        ranges.push(...nonProseRanges(part, lang).map((r) => ({ from: r.from + start, to: r.to + start })));
        break;
      }
      const at = start + match.index;
      // Comments consume the rest of a line; ignore delimiters inside them.
      const prefix = text.slice(start, at);
      const comment =
        lang === 'latex' ? /(?<!\\)%/.exec(prefix) : lang === 'typst' ? /\/\//.exec(prefix) : null;
      if (comment) {
        ranges.push(
          ...nonProseRanges(text.slice(start), lang).map((r) => ({ from: r.from + start, to: r.to + start })),
        );
        break;
      }
      ranges.push(...nonProseRanges(prefix, lang).map((r) => ({ from: r.from + start, to: r.to + start })));
      state = match[1]
        ? `\\end{${match[1]}}`
        : match[0] === '\\['
          ? '\\]'
          : match[0] === '/*'
            ? '*/'
            : match[0];
      ranges.push({ from: at, to: at + match[0].length });
      start = at + match[0].length;
    }
  }
  return { text, state, ranges };
}
export class ProseIndex {
  private lines: Line[] = [];
  stateBefore(line: number): string {
    return this.lines[line - 2]?.state ?? '';
  }
  constructor(private language: Lang) {}
  update(
    doc: Text,
    first = 1,
    changedThrough = doc.lines,
    delta = 0,
  ): { from: number; to: number; ranges: TextRange[]; scanned: number } {
    const old = this.lines;
    let next = old.slice(0, first - 1);
    const ranges: TextRange[] = [];
    let state = next.at(-1)?.state ?? '',
      last = first - 1,
      scanned = 0;
    for (let n = first; n <= doc.lines; n++) {
      const line = doc.line(n),
        cached = old[n - 1 - delta];
      if (n > changedThrough && cached?.text === line.text && (old[n - 2 - delta]?.state ?? '') === state) {
        next = next.concat(old.slice(n - 1 - delta));
        break;
      }
      const entry = scan(line.text, state, this.language);
      next.push(entry);
      state = entry.state;
      last = n;
      scanned++;
      ranges.push(
        ...entry.ranges
          .filter((r) => r.to > r.from)
          .map((r) => ({ from: line.from + r.from, to: line.from + r.to })),
      );
    }
    this.lines = next;
    return { from: doc.line(first).from, to: doc.line(Math.max(first, last)).to, ranges, scanned };
  }
}
