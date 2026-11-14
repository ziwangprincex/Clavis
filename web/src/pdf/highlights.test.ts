import { describe, expect, it } from 'vitest';
import { locate, mergeLineRects, pageFingerprint, parseHighlights, reanchor, serializeHighlights, type PageText, type PdfHighlight } from './highlights';

// A 600×800 page: PDF y grows upwards, page units grow downwards.
const VIEWPORT = [1, 0, 0, -1, 0, 800];

/** One text item per line, 6 units per character, 10 units high. */
function page(...lines: string[]): PageText {
  return {
    viewport: VIEWPORT,
    items: lines.map((str, i) => ({ str, transform: [10, 0, 0, 10, 50, 700 - i * 20], width: str.length * 6, height: 10 })),
  };
}

const highlight = (overrides: Partial<PdfHighlight> = {}): PdfHighlight => ({
  id: 'h', page: 1, text: 'world', created: '', rects: locate(page('hello world'), 'world')[0], ...overrides,
});

describe('PDF highlights', () => {
  it('round-trips the file and drops malformed entries', () => {
    const list = [highlight()];
    expect(parseHighlights(serializeHighlights(list))).toEqual(list);
    expect(parseHighlights('')).toEqual([]);
    expect(parseHighlights('{broken')).toEqual([]);
    expect(parseHighlights(JSON.stringify({ highlights: [{ id: 'x', page: 0, text: '', rects: [] }, { id: 'y' }] }))).toEqual([]);
  });

  it('joins the rectangles of one line into a band', () => {
    const merged = mergeLineRects([
      { x: 40, y: 10, w: 20, h: 10 },
      { x: 10, y: 10, w: 28, h: 10 },
      { x: 10, y: 30, w: 50, h: 10 },
    ]);
    expect(merged).toEqual([{ x: 10, y: 10, w: 50, h: 10 }, { x: 10, y: 30, w: 50, h: 10 }]);
  });

  it('finds text across items, ignoring spaces, hyphens and ligatures', () => {
    const text = page('the classi-', 'ﬁcation of things');
    const [rects] = locate(text, 'classification');
    expect(rects).toHaveLength(2);
    expect(rects[0].y).toBeLessThan(rects[1].y);
    expect(rects[0].x).toBeCloseTo(50 + 4 * 6);
    expect(locate(text, 'missing')).toEqual([]);
  });

  it('leaves a highlight on an unchanged page exactly as it is', async () => {
    // Rectangles from a real selection differ from the estimate; an unchanged page keeps them.
    const exact = highlight({ rects: [{ x: 90, y: 92, w: 31, h: 11 }], pageHash: pageFingerprint(page('hello world')) });
    expect(await reanchor(exact, 1, async () => page('hello world'))).toBe(exact);
  });

  it('keeps the rectangles where the text is still on its line', async () => {
    const original = highlight({ rects: [{ x: 90, y: 92, w: 31, h: 11 }] });
    const kept = await reanchor(original, 1, async () => page('hello world', 'a line added below'));
    expect(kept.rects).toBe(original.rects);
    expect(kept.pageHash).toBe(pageFingerprint(page('hello world', 'a line added below')));
  });

  it('follows text that moved to another line or page', async () => {
    const original = highlight();
    const moved = await reanchor(original, 1, async () => page('a new first line', 'hello world'));
    expect(moved.page).toBe(1);
    expect(moved.rects[0].y).toBeGreaterThan(original.rects[0].y);
    const nextPage = await reanchor(original, 2, async n => (n === 2 ? page('world') : page('nothing here')));
    expect(nextPage.page).toBe(2);
  });

  it('picks the occurrence nearest to where it was', async () => {
    const original = highlight({ text: 'b', rects: locate(page('a b c', 'x', 'a b c'), 'b')[1] });
    const moved = await reanchor(original, 1, async () => page('a b c', 'x', 'y', 'a b c'));
    expect(moved.rects[0].y).toBeCloseTo(locate(page('a b c', 'x', 'y', 'a b c'), 'b')[1][0].y);
  });

  it('keeps text that is gone as an orphan, and restores it when it returns', async () => {
    const lost = await reanchor(highlight(), 1, async () => page('nothing here'));
    expect(lost.orphan).toBe(true);
    const back = await reanchor(lost, 1, async () => page('hello world'));
    expect(back.orphan).toBeUndefined();
  });
});
