import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfTextIndex, findPdfMatches, type PdfMatch } from '../pdf/search';
import styles from '../components/PdfViewer.module.css';

export interface PdfSearch {
  findOpen: boolean;
  findQuery: string;
  findCase: boolean;
  findCount: number;
  findIndex: number;
  searching: boolean;
  searchError: string | null;
  findInputRef: React.RefObject<HTMLInputElement>;
  setFindQuery: (q: string) => void;
  setFindCase: (c: boolean) => void;
  applyHighlights: () => void;
  openFinder: () => void;
  closeFinder: () => void;
  gotoMatch: (delta: number) => void;
}

type IndexedMatch = { hit: PdfMatch; index: number };
export function usePdfSearch(containerRef: React.RefObject<HTMLDivElement>, doc: PDFDocumentProxy | null): PdfSearch {
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCase, setFindCase] = useState(false);
  const [findCount, setFindCount] = useState(0);
  const [findIndex, setFindIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const textIndex = useMemo(() => doc ? new PdfTextIndex(doc) : null, [doc]);
  const matchesRef = useRef<PdfMatch[]>([]);
  const byPage = useRef(new Map<number, IndexedMatch[]>());
  const marks = useRef<{ el: HTMLSpanElement; index: number }[]>([]);
  const indexRef = useRef(-1);
  const selected = useRef<{ page: number; from: number; index: number }>();
  const previousQuery = useRef('');
  const findInputRef = useRef<HTMLInputElement>(null);

  const clearHighlights = useCallback(() => {
    const parents = new Set(marks.current.map(mark => mark.el.parentElement));
    for (const span of parents) if (span) span.textContent = span.textContent;
    marks.current = [];
  }, []);

  // Paint is deliberately independent of search/count/navigation. Evicting or
  // repainting pages cannot change which occurrence the reader selected.
  const applyHighlights = useCallback(() => {
    clearHighlights();
    const layers = containerRef.current?.querySelectorAll<HTMLElement>(`.${styles.textLayer}`) ?? [];
    for (const layer of layers) {
      const page = Number(layer.closest<HTMLElement>('[data-page]')?.dataset.page);
      const hits = byPage.current.get(page);
      if (!hits) continue;
      const ranges = new Map<number, { from: number; to: number; index: number }[]>();
      for (const { hit, index } of hits) for (const part of hit.parts) {
        const parts = ranges.get(part.item) ?? [];
        parts.push({ ...part, index });
        ranges.set(part.item, parts);
      }
      for (const span of layer.querySelectorAll<HTMLElement>('[data-text-index]')) {
        const parts = ranges.get(Number(span.dataset.textIndex));
        if (!parts) continue;
        const text = span.textContent ?? '';
        const fragment = document.createDocumentFragment();
        let last = 0;
        for (const part of parts) {
          fragment.appendChild(document.createTextNode(text.slice(last, part.from)));
          const mark = document.createElement('span');
          mark.className = styles.match;
          mark.textContent = text.slice(part.from, part.to);
          if (part.index === indexRef.current) mark.classList.add(styles.matchActive);
          fragment.appendChild(mark);
          marks.current.push({ el: mark, index: part.index });
          last = part.to;
        }
        fragment.appendChild(document.createTextNode(text.slice(last)));
        span.replaceChildren(fragment);
      }
    }
  }, [containerRef, clearHighlights]);

  const selectMatch = useCallback((index: number, navigate: boolean) => {
    indexRef.current = index;
    setFindIndex(index);
    const hit = matchesRef.current[index];
    if (hit) selected.current = { page: hit.page, from: hit.from, index };
    for (const mark of marks.current) mark.el.classList.toggle(styles.matchActive, mark.index === index);
    if (!navigate || !hit) return;
    // Page wrappers exist even when their text/canvas has been evicted.
    const host = containerRef.current;
    const wrap = host?.querySelector<HTMLElement>(`[data-page="${hit.page}"]`);
    if (host && wrap) host.scrollTop = Math.max(0, wrap.offsetTop + hit.y * wrap.clientHeight - host.clientHeight / 3);
  }, [containerRef]);

  useEffect(() => {
    let cancelled = false;
    const queryKey = `${findCase}:${findQuery}`;
    const changed = previousQuery.current !== queryKey;
    previousQuery.current = queryKey;
    const previous = changed ? undefined : selected.current;
    clearHighlights();
    matchesRef.current = [];
    byPage.current.clear();
    indexRef.current = -1;
    setFindCount(0);
    setFindIndex(-1);
    setSearchError(null);
    setSearching(false);
    if (!findOpen || !findQuery.trim() || !textIndex) return;
    setSearching(true);
    void textIndex.load(() => cancelled).then(pages => {
      if (cancelled || !pages) return;
      const hits = findPdfMatches(pages, findQuery, findCase);
      matchesRef.current = hits;
      hits.forEach((hit, index) => {
        const group = byPage.current.get(hit.page) ?? [];
        group.push({ hit, index });
        byPage.current.set(hit.page, group);
      });
      const same = hits.findIndex(hit => hit.page === previous?.page && hit.from === previous.from);
      const index = hits.length ? (same >= 0 ? same : Math.min(previous?.index ?? 0, hits.length - 1)) : -1;
      setFindCount(hits.length);
      setSearching(false);
      selectMatch(index, changed || !previous);
      applyHighlights();
    }).catch(error => {
      if (!cancelled) {
        setSearching(false);
        setSearchError(String(error));
      }
    });
    return () => { cancelled = true; };
  }, [findOpen, findQuery, findCase, textIndex, clearHighlights, selectMatch, applyHighlights]);

  const openFinder = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, []);
  function closeFinder() {
    setFindOpen(false);
    setFindQuery('');
    selected.current = undefined;
  }
  function gotoMatch(delta: number) {
    const count = matchesRef.current.length;
    if (count) selectMatch(((indexRef.current + delta) % count + count) % count, true);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'f') return;
      const root = containerRef.current?.parentElement;
      const active = document.activeElement;
      if (!root || (active && !root.contains(active) && active !== document.body)) return;
      e.preventDefault();
      openFinder();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [containerRef, openFinder]);

  useEffect(() => clearHighlights, [clearHighlights]);
  return {
    findOpen, findQuery, findCase, findCount, findIndex, searching, searchError, findInputRef,
    setFindQuery, setFindCase, applyHighlights, openFinder, closeFinder, gotoMatch,
  };
}
