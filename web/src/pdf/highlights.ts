// Highlights on a compiled PDF. A highlight keeps its page, its rectangles and
// the text it covers. Rectangles are in page units at 100% zoom, origin top
// left, the space PdfPages lays pages out in. A rebuild may move the text, so
// each highlight is checked against the new PDF and, if its text moved,
// re-anchored on the nearest occurrence of that text.

export interface HighlightRect { x: number; y: number; w: number; h: number }

export interface PdfHighlight {
  id: string;
  page: number;
  rects: HighlightRect[];
  text: string;
  created: string;
  /** Fingerprint of the page's text when the rectangles were last right. */
  pageHash?: string;
  /** The text was not found in the latest PDF; kept, but not drawn. */
  orphan?: boolean;
}

/** The parts of a pdf.js text item the search reads. */
export interface TextItemLike { str: string; transform: number[]; width: number; height: number }

/** One page's text and its scale-1 viewport transform (PDF space → page units). */
export interface PageText { items: TextItemLike[]; viewport: number[] }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isRect(value: unknown): value is HighlightRect {
  const rect = value as HighlightRect;
  return !!rect && finite(rect.x) && finite(rect.y) && finite(rect.w) && finite(rect.h) && rect.w > 0 && rect.h > 0;
}

/** The highlights in a file's text; anything malformed is dropped, an empty or broken file is none. */
export function parseHighlights(json: string): PdfHighlight[] {
  if (!json.trim()) return [];
  let value: unknown;
  try { value = JSON.parse(json); } catch { return []; }
  const list = (value as { highlights?: unknown })?.highlights;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): PdfHighlight[] => {
    const item = entry as Partial<PdfHighlight>;
    if (typeof item?.id !== 'string' || !finite(item.page) || item.page < 1 || typeof item.text !== 'string' || !Array.isArray(item.rects)) return [];
    const rects = item.rects.filter(isRect);
    if (!rects.length) return [];
    return [{
      id: item.id,
      page: Math.floor(item.page),
      rects,
      text: item.text,
      created: typeof item.created === 'string' ? item.created : '',
      ...(typeof item.pageHash === 'string' ? { pageHash: item.pageHash } : {}),
      ...(item.orphan ? { orphan: true } : {}),
    }];
  });
}

export function serializeHighlights(list: PdfHighlight[]): string {
  return JSON.stringify({ version: 1, highlights: list }, null, 2) + '\n';
}

export function newHighlightId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Rectangles of one line joined into one band: a selection reports one per text run and space. */
export function mergeLineRects(rects: HighlightRect[]): HighlightRect[] {
  const sorted = rects.filter(isRect).sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: HighlightRect[] = [];
  for (const rect of sorted) {
    const last = merged[merged.length - 1];
    const overlap = last ? Math.min(last.y + last.h, rect.y + rect.h) - Math.max(last.y, rect.y) : 0;
    const sameLine = last && overlap > 0.5 * Math.min(last.h, rect.h);
    if (sameLine && rect.x <= last.x + last.w + 0.6 * Math.max(last.h, rect.h)) {
      const top = Math.min(last.y, rect.y);
      const bottom = Math.max(last.y + last.h, rect.y + rect.h);
      const right = Math.max(last.x + last.w, rect.x + rect.w);
      last.x = Math.min(last.x, rect.x);
      last.w = right - last.x;
      last.y = top;
      last.h = bottom - top;
    } else {
      merged.push({ ...rect });
    }
  }
  return merged;
}

/** Spaces, line breaks and hyphens differ between builds of the same text; ligatures are folded. */
const IGNORED = /[\s­\-‐‑]/u;

function normalize(text: string): string {
  let out = '';
  for (const char of text) {
    if (IGNORED.test(char)) continue;
    out += char.normalize('NFKC');
  }
  return out;
}

/** Fingerprint of a page's text (FNV-1a over the normalized characters). */
export function pageFingerprint(page: PageText): string {
  let hash = 0x811c9dc5;
  for (const item of page.items) {
    const text = normalize(item.str);
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Part of one text item as a rectangle in page units. Glyph widths inside an
 *  item are not known, so the part is placed in proportion to its characters. */
function itemRect(item: TextItemLike, from: number, to: number, viewport: number[]): HighlightRect | null {
  const [, , , , e, f] = item.transform;
  const length = item.str.length || 1;
  const height = item.height || Math.hypot(item.transform[2], item.transform[3]);
  if (!height) return null;
  const x1 = e + (item.width * from) / length;
  const x2 = e + (item.width * to) / length;
  // pdf.js sets text spans from the baseline up by the font ascent; 0.8 is its default.
  const [ax, ay] = apply(viewport, x1, f - 0.2 * height);
  const [bx, by] = apply(viewport, x2, f + 0.8 * height);
  const rect = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  return isRect(rect) ? rect : null;
}

/** Every place the text occurs on a page, each as line bands. */
export function locate(page: PageText, text: string): HighlightRect[][] {
  const needle = normalize(text);
  if (!needle) return [];
  // Each kept character remembers the item and offset it came from.
  let haystack = '';
  const origin: Array<{ item: number; offset: number }> = [];
  page.items.forEach((item, index) => {
    let offset = 0;
    for (const char of item.str) {
      if (!IGNORED.test(char)) {
        for (const folded of char.normalize('NFKC')) {
          haystack += folded;
          origin.push({ item: index, offset });
        }
      }
      offset += char.length;
    }
  });
  const found: HighlightRect[][] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    const parts = new Map<number, { from: number; to: number }>();
    for (let i = at; i < at + needle.length; i++) {
      const { item, offset } = origin[i];
      const end = offset + (page.items[item].str.codePointAt(offset)! > 0xffff ? 2 : 1);
      const part = parts.get(item);
      if (part) part.to = Math.max(part.to, end);
      else parts.set(item, { from: offset, to: end });
    }
    const rects = [...parts].flatMap(([item, { from, to }]) => itemRect(page.items[item], from, to, page.viewport) ?? []);
    if (rects.length) found.push(mergeLineRects(rects));
  }
  return found;
}

function bounds(rects: HighlightRect[]): HighlightRect {
  const left = Math.min(...rects.map(r => r.x));
  const top = Math.min(...rects.map(r => r.y));
  const right = Math.max(...rects.map(r => r.x + r.w));
  const bottom = Math.max(...rects.map(r => r.y + r.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Whether two sets of rectangles mark the same place: the same lines, and
 *  horizontally overlapping or close, as an estimate within a line can be off
 *  by a few characters. */
function samePlace(a: HighlightRect[], b: HighlightRect[]): boolean {
  const p = bounds(a);
  const q = bounds(b);
  const vertical = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
  if (vertical <= 0.5 * Math.min(p.h, q.h)) return false;
  const gap = Math.max(p.x, q.x) - Math.min(p.x + p.w, q.x + q.w);
  return gap < 2 * Math.max(a[0].h, b[0].h);
}

function distance(a: HighlightRect[], b: HighlightRect[]): number {
  const p = bounds(a);
  const q = bounds(b);
  return Math.hypot(p.x + p.w / 2 - (q.x + q.w / 2), p.y + p.h / 2 - (q.y + q.h / 2));
}

/** Pages to search, nearest to `page` first. */
function searchOrder(page: number, count: number): number[] {
  const order = [Math.min(Math.max(page, 1), count)];
  for (let step = 1; order.length < count; step++) {
    if (page - step >= 1) order.push(page - step);
    if (page + step <= count) order.push(page + step);
  }
  return order;
}

/**
 * The highlight placed in a (possibly rebuilt) PDF. On a page whose text is
 * unchanged it stays exactly as it is. Otherwise it stays where its text still
 * is, or moves to the nearest occurrence of its text, on its page first and
 * then on the pages around it. With no occurrence it becomes an orphan.
 * Returns the same object when nothing changed.
 */
export async function reanchor(
  highlight: PdfHighlight,
  pageCount: number,
  pageText: (page: number) => Promise<PageText | null>,
): Promise<PdfHighlight> {
  if (pageCount < 1) return highlight;
  const { orphan: _orphan, ...placed } = highlight;
  for (const page of searchOrder(highlight.page, pageCount)) {
    const text = await pageText(page);
    if (!text) continue;
    const hash = pageFingerprint(text);
    if (page === highlight.page && hash === highlight.pageHash) return highlight.orphan ? placed : highlight;
    const found = locate(text, highlight.text);
    if (!found.length) continue;
    if (page === highlight.page && found.some(rects => samePlace(rects, highlight.rects))) return { ...placed, pageHash: hash };
    const nearest = found.reduce((best, rects) => distance(rects, highlight.rects) < distance(best, highlight.rects) ? rects : best);
    return { ...placed, page, rects: nearest, pageHash: hash };
  }
  return highlight.orphan ? highlight : { ...highlight, orphan: true };
}
