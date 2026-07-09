// usePdfSearch — in-PDF text find, extracted from PdfViewer.
//
// Operates on the rendered `.textLayer` DOM (a stable seam): wraps matches in
// `.match` spans, tracks the active match, and drives Prev/Next navigation.
// The owning component passes its scroll `containerRef` in and calls the
// returned `applyHighlights` whenever a page (re)paints.
//
// Imports the same CSS module as PdfViewer so the class-name strings are
// identical to the pre-extraction inline code.

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../components/PdfViewer.module.css';

interface MatchRef {
  el: HTMLSpanElement;
  page: number;
}

export interface PdfSearch {
  findOpen: boolean;
  findQuery: string;
  findCase: boolean;
  findCount: number;
  findIndex: number;
  findInputRef: React.RefObject<HTMLInputElement>;
  setFindQuery: (q: string) => void;
  setFindCase: (c: boolean) => void;
  applyHighlights: () => void;
  openFinder: () => void;
  closeFinder: () => void;
  gotoMatch: (delta: number) => void;
}

export function usePdfSearch(containerRef: React.RefObject<HTMLDivElement>): PdfSearch {
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCase, setFindCase] = useState(false);
  const [findCount, setFindCount] = useState(0);
  const [findIndex, setFindIndex] = useState(-1);
  const matchesRef = useRef<MatchRef[]>([]);
  const findInputRef = useRef<HTMLInputElement>(null);

  function clearHighlights() {
    for (const m of matchesRef.current) {
      const span = m.el.parentNode as HTMLElement | null;
      if (!span) continue;
      // Re-collapse the wrapping span back to plain text.
      span.textContent = span.textContent;
    }
    matchesRef.current = [];
    setFindCount(0);
    setFindIndex(-1);
  }

  const applyHighlights = useCallback(() => {
    clearHighlights();
    const container = containerRef.current;
    if (!container) return;
    const q = findQuery;
    if (!q) return;
    let needle: RegExp;
    try {
      needle = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), findCase ? 'g' : 'gi');
    } catch {
      return;
    }

    const layers = container.querySelectorAll<HTMLDivElement>(`.${styles.textLayer}`);
    const matches: MatchRef[] = [];
    layers.forEach((layer, idx) => {
      const page = idx + 1;
      const spans = layer.querySelectorAll<HTMLSpanElement>('span');
      for (const span of spans) {
        if (span.children.length > 0) continue;
        const text = span.textContent ?? '';
        if (!text) continue;
        needle.lastIndex = 0;
        if (!needle.test(text)) continue;
        needle.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = needle.exec(text)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          const mark = document.createElement('span');
          mark.className = styles.match;
          mark.textContent = m[0];
          frag.appendChild(mark);
          matches.push({ el: mark, page });
          last = m.index + m[0].length;
          if (m[0].length === 0) needle.lastIndex++;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        span.textContent = '';
        span.appendChild(frag);
      }
    });

    matchesRef.current = matches;
    setFindCount(matches.length);
    if (matches.length) {
      setFindIndex(0);
    } else {
      setFindIndex(-1);
    }
  }, [findQuery, findCase, containerRef]);

  // Activate the current match (highlighted distinctly + scrolled into view).
  useEffect(() => {
    const matches = matchesRef.current;
    for (const m of matches) m.el.classList.remove(styles.matchActive);
    if (findIndex < 0 || findIndex >= matches.length) return;
    const m = matches[findIndex];
    m.el.classList.add(styles.matchActive);
    m.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [findIndex]);

  // Re-apply highlights whenever the query/case-flag changes.
  useEffect(() => {
    if (!findOpen) return;
    applyHighlights();
  }, [findOpen, applyHighlights]);

  function openFinder() {
    setFindOpen(true);
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }
  function closeFinder() {
    setFindOpen(false);
    setFindQuery('');
    clearHighlights();
  }

  function gotoMatch(delta: number) {
    const n = matchesRef.current.length;
    if (!n) return;
    setFindIndex(i => ((i + delta) % n + n) % n);
  }

  // Ctrl/Cmd+F to open finder, scoped to PDF viewer focus.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'f') {
        // Only intercept when the PDF viewer (or its inputs) has focus.
        const root = container?.parentElement;
        const active = document.activeElement;
        if (!root || (active && !root.contains(active) && active !== document.body)) return;
        e.preventDefault();
        openFinder();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    findOpen,
    findQuery,
    findCase,
    findCount,
    findIndex,
    findInputRef,
    setFindQuery,
    setFindCase,
    applyHighlights,
    openFinder,
    closeFinder,
    gotoMatch,
  };
}
