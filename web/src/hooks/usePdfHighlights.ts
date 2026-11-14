// Highlights on the LaTeX PDF: made from a text selection, kept in a file
// beside the main source, placed again after every build, and removed from a
// click on them. Both the main window and the PDF window show them; each edit
// reads, changes and writes the file in one step and tells the other window.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { emit, hasTauri, ipc, listen } from '../api/tauri';
import {
  mergeLineRects, newHighlightId, pageFingerprint, parseHighlights, reanchor, serializeHighlights,
  type HighlightRect, type PageText, type PdfHighlight, type TextItemLike,
} from '../pdf/highlights';
import type { PdfPages } from '../pdf/pages';
import { setStatus } from '../store/status';
import pageStyles from '../components/PdfViewer.module.css';

const CHANGED = 'pdf-highlights-changed';

/** Highlights belong to a compiled, saved main .tex file. */
export const highlightSource = (root: string | null | undefined): string | null => (root && /\.tex$/i.test(root) ? root : null);

async function update(source: string, change: (list: PdfHighlight[]) => PdfHighlight[]): Promise<void> {
  const next = change(parseHighlights(await ipc.readPdfHighlights(source)));
  await ipc.writePdfHighlights(source, serializeHighlights(next));
  void emit(CHANGED, { source }).catch(() => {});
}

/** The selected text inside the pages, per page, in page units. */
function selectedText(container: HTMLElement, zoom: number): Array<{ page: number; rects: HighlightRect[]; text: string }> {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return [];
  const range = selection.getRangeAt(0);
  const found: Array<{ page: number; rects: HighlightRect[]; text: string }> = [];
  for (const wrap of container.querySelectorAll<HTMLElement>(`.${pageStyles.page}`)) {
    const layer = wrap.querySelector('.textLayer');
    if (!layer || !range.intersectsNode(wrap)) continue;
    const box = wrap.getBoundingClientRect();
    const rects: HighlightRect[] = [];
    let text = '';
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (!range.intersectsNode(node)) continue;
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.length;
      if (from >= to) continue;
      const part = document.createRange();
      part.setStart(node, from);
      part.setEnd(node, to);
      for (const rect of part.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) {
          rects.push({ x: (rect.left - box.left) / zoom, y: (rect.top - box.top) / zoom, w: rect.width / zoom, h: rect.height / zoom });
        }
      }
      text += node.data.slice(from, to);
    }
    const lines = mergeLineRects(rects);
    if (lines.length && text.trim()) found.push({ page: Number(wrap.dataset.page) || 1, rects: lines, text: text.trim() });
  }
  return found;
}

function selectionInside(container: HTMLElement | null): boolean {
  const selection = window.getSelection();
  return !!container && !!selection && !selection.isCollapsed && !!selection.anchorNode && container.contains(selection.anchorNode);
}

export interface HighlightMenu { id: string; x: number; y: number }

export function usePdfHighlights(
  containerRef: RefObject<HTMLDivElement>,
  pagesRef: RefObject<PdfPages | null>,
  zoomRef: RefObject<number>,
  doc: PDFDocumentProxy | null,
  source: string | null,
) {
  const [highlights, setHighlights] = useState<PdfHighlight[]>([]);
  const [menu, setMenu] = useState<HighlightMenu | null>(null);
  const [canHighlight, setCanHighlight] = useState(false);
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  /** The source the shown highlights were read for. */
  const loadedRef = useRef<string | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // Each page's text is read once per document.
  const texts = useRef(new Map<number, Promise<PageText | null>>());
  const pageText = useCallback((n: number): Promise<PageText | null> => {
    let text = texts.current.get(n);
    if (!text) {
      text = doc
        ? doc.getPage(n).then(async page => ({
          items: (await page.getTextContent()).items.filter((item): item is TextItemLike & typeof item => 'str' in item),
          viewport: page.getViewport({ scale: 1 }).transform,
        })).catch(() => null)
        : Promise.resolve(null);
      texts.current.set(n, text);
    }
    return text;
  }, [doc]);

  // A new PDF: read the file and place every highlight in it. Highlights the
  // build moved are written back; another window's edit is only read.
  useEffect(() => {
    texts.current = new Map();
    setMenu(null);
    if (loadedRef.current !== source) {
      loadedRef.current = null;
      setHighlights([]);
    }
    if (!source || !doc || !hasTauri()) return;
    let cancelled = false;
    const load = async (persist: boolean) => {
      const stored = parseHighlights(await ipc.readPdfHighlights(source));
      const placed = await Promise.all(stored.map(highlight => reanchor(highlight, doc.numPages, pageText)));
      if (cancelled) return;
      loadedRef.current = source;
      setHighlights(placed);
      const moved = new Map(placed.filter((highlight, i) => highlight !== stored[i]).map(highlight => [highlight.id, highlight]));
      if (persist && moved.size) await update(source, list => list.map(highlight => moved.get(highlight.id) ?? highlight));
    };
    void load(true).catch(error => console.warn('PDF highlights unavailable', error));
    const off = listen<{ source: string }>(CHANGED, payload => {
      if (payload?.source === source) void load(false).catch(error => console.warn('PDF highlights unavailable', error));
    });
    return () => {
      cancelled = true;
      void off.then(stop => stop());
    };
  }, [source, doc, pageText]);

  useEffect(() => {
    pagesRef.current?.setHighlights(highlights, menu?.id ?? null);
  }, [highlights, menu, doc, pagesRef]);

  /** Pages built for the next PDF start with the current highlights, so a rebuild does not flash them away. */
  const seed = useCallback((pages: PdfPages) => {
    if (loadedRef.current && loadedRef.current === sourceRef.current) pages.setHighlights(highlightsRef.current);
  }, []);

  useEffect(() => {
    if (!source) { setCanHighlight(false); return; }
    const check = () => setCanHighlight(selectionInside(containerRef.current));
    document.addEventListener('selectionchange', check);
    check();
    return () => document.removeEventListener('selectionchange', check);
  }, [source, containerRef]);

  const highlightSelection = useCallback(async () => {
    const container = containerRef.current;
    if (!source || !container || !doc) return;
    const found = selectedText(container, zoomRef.current ?? 1);
    if (!found.length) {
      setStatus('Select text in the PDF to highlight it', 'info');
      return;
    }
    const created = new Date().toISOString();
    const added: PdfHighlight[] = await Promise.all(found.map(async mark => {
      const text = await pageText(mark.page);
      return { id: newHighlightId(), ...mark, created, ...(text ? { pageHash: pageFingerprint(text) } : {}) };
    }));
    window.getSelection()?.removeAllRanges();
    setHighlights(list => [...list, ...added]);
    try {
      await update(source, list => [...list, ...added]);
    } catch (error) {
      console.error('could not save highlights', error);
      setHighlights(list => list.filter(highlight => !added.includes(highlight)));
      setStatus('Highlights could not be saved', 'error');
    }
  }, [source, doc, containerRef, zoomRef, pageText]);

  const removeHighlight = useCallback(async (id: string) => {
    setMenu(null);
    if (!source) return;
    const removed = highlightsRef.current.find(highlight => highlight.id === id);
    setHighlights(list => list.filter(highlight => highlight.id !== id));
    try {
      await update(source, list => list.filter(highlight => highlight.id !== id));
    } catch (error) {
      console.error('could not save highlights', error);
      if (removed) setHighlights(list => [...list, removed]);
      setStatus('Highlights could not be saved', 'error');
    }
  }, [source]);

  /** The highlight under a point of a page, in page units. */
  const highlightAt = useCallback((page: number, x: number, y: number): string | null => {
    const hit = highlightsRef.current.find(highlight => !highlight.orphan && highlight.page === page
      && highlight.rects.some(rect => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h));
    return hit?.id ?? null;
  }, []);

  // Cmd/Ctrl+Shift+H highlights a selection made in this viewer.
  useEffect(() => {
    if (!source) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'h') return;
      if (!selectionInside(containerRef.current)) return;
      event.preventDefault();
      void highlightSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, containerRef, highlightSelection]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  return { available: !!source, highlights, canHighlight, menu, setMenu, highlightSelection, removeHighlight, highlightAt, seed };
}
