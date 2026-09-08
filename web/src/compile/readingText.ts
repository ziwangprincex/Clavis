import type { TypstPage } from '../api/tauri';
export interface ReadingMatch {
  page: number;
  from: number;
  to: number;
  runs: number[];
}
export function readingText(page: TypstPage) {
  let text = '';
  const offsets: { from: number; to: number }[] = [];
  page.text.forEach((run, i) => {
    const previous = page.text[i - 1];
    if (
      previous &&
      Math.abs(previous.matrix[5] - run.matrix[5]) > run.size * 0.5 &&
      text &&
      !/\s$/.test(text)
    )
      text += ' ';
    const from = text.length;
    text += run.text.replace(/\s/g, ' ');
    offsets.push({ from, to: text.length });
  });
  return { text, offsets };
}
export function findReadingMatches(pages: TypstPage[], query: string): ReadingMatch[] {
  if (!query.trim()) return [];
  const needle = query.toLowerCase();
  return pages.flatMap((page, index) => {
    const { text, offsets } = readingText(page);
    const searchable = text.toLowerCase();
    const hits: ReadingMatch[] = [];
    for (let at = searchable.indexOf(needle); at >= 0; at = searchable.indexOf(needle, at + needle.length)) {
      hits.push({
        page: index,
        from: at,
        to: at + needle.length,
        runs: offsets.flatMap((range, i) => (range.to > at && range.from < at + needle.length ? [i] : [])),
      });
    }
    return hits;
  });
}
