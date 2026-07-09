// PdfViewer — continuous-scroll PDF viewer using pdfjs-dist.
//
// - Renders each page to a canvas + a transparent text layer on top so users
//   can select text AND we can highlight search matches.
// - SyncTeX reverse search: clicking a page surface (without selecting text)
//   reports (page, xPoints, yPoints) up via onSyncTexBackward.
// - Text search (Ctrl+F): scans the rendered text layers, wraps each match
//   in a `.pdf-match` span, and provides Prev/Next navigation.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import { ensurePdfjs } from '../pdf/pdfjs';
import { IconSearch } from './icons';
import { usePdfStore, useSettingsStore } from '../store';
import { usePdfSearch } from '../hooks/usePdfSearch';
// We import a minimal subset of pdfjs's textLayer CSS — see ../pdf/textLayer.css.
import '../pdf/textLayer.css';
import styles from './PdfViewer.module.css';

export interface PdfViewerProps {
  onSyncTexBackward?: (page: number, x: number, y: number) => void;
}

export function PdfViewer({ onSyncTexBackward }: PdfViewerProps) {
  const bytes = usePdfStore(s => s.bytes);
  const zoom = usePdfStore(s => s.zoom);
  const setZoom = usePdfStore(s => s.setZoom);
  const setNumPages = usePdfStore(s => s.setNumPages);
  const setCurrentPage = usePdfStore(s => s.setCurrentPage);
  const numPages = usePdfStore(s => s.numPages);
  const currentPage = usePdfStore(s => s.currentPage);
  const scrollRequest = usePdfStore(s => s.scrollRequest);

  const pdfBg = useSettingsStore(s => s.settings.pdf_bg_color);
  const pdfDarkMode = useSettingsStore(s => s.settings.pdf_dark_mode);

  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const renderSeqRef = useRef(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [error, setError] = useState<string | null>(null);

  // In-PDF text find (operates on the rendered .textLayer DOM).
  const {
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
  } = usePdfSearch(containerRef);

  // ---- PDF load ----
  useEffect(() => {
    return () => {
      // Tear down observer + doc on PdfViewer unmount.
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (docRef.current) {
        docRef.current.destroy().catch(() => {});
        docRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!bytes) {
        if (docRef.current) {
          await docRef.current.destroy().catch(() => {});
          docRef.current = null;
        }
        setNumPages(0);
        setCurrentPage(1);
        if (containerRef.current) containerRef.current.innerHTML = '';
        return;
      }
      try {
        const pdfjs = ensurePdfjs();
        const data = new Uint8Array(bytes);
        const newDoc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          await newDoc.destroy().catch(() => {});
          return;
        }
        if (docRef.current) {
          await docRef.current.destroy().catch(() => {});
        }
        docRef.current = newDoc;
        setNumPages(newDoc.numPages);
        setCurrentPage(1);
        setError(null);
        await renderAll();
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  useEffect(() => {
    if (!docRef.current) return;
    const raf = requestAnimationFrame(() => {
      void renderAll();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const renderAll = useCallback(async () => {
    const container = containerRef.current;
    const doc = docRef.current;
    if (!container || !doc) return;
    const seq = ++renderSeqRef.current;
    // Preserve scroll so recompiles don't yank the user back to page 1.
    const savedScrollTop = container.scrollTop;
    const savedScrollLeft = container.scrollLeft;
    container.innerHTML = '';
    const dpr = window.devicePixelRatio || 1;
    ensurePdfjs();

    // Phase 1: lay out empty page placeholders sized to each page's viewport.
    // We need true sizes for correct scroll height & IntersectionObserver math,
    // so we still call getPage(i) up front — but rendering the canvas is
    // deferred until the placeholder enters the viewport.
    type SlotState = { rendered: boolean; rendering: boolean };
    const slots = new Map<HTMLDivElement, SlotState>();
    const pages: { wrap: HTMLDivElement; viewport: ReturnType<Awaited<ReturnType<typeof doc.getPage>>['getViewport']>; index: number }[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
      if (seq !== renderSeqRef.current) return;
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: zoom });
      const wrap = document.createElement('div');
      wrap.className = styles.page;
      wrap.dataset.page = String(i);
      wrap.style.width = viewport.width + 'px';
      wrap.style.height = viewport.height + 'px';
      wrap.style.setProperty('--scale-factor', String(zoom));
      container.appendChild(wrap);
      slots.set(wrap, { rendered: false, rendering: false });
      pages.push({ wrap, viewport, index: i });
    }

    async function paint(idx: number, wrap: HTMLDivElement, viewport: typeof pages[number]['viewport']) {
      if (seq !== renderSeqRef.current) return;
      const slot = slots.get(wrap);
      if (!slot || slot.rendered || slot.rendering) return;
      // doc is captured by closure but TS forgets the narrowing across the
      // async boundary; re-check explicitly.
      const d = docRef.current;
      if (!d) return;
      slot.rendering = true;
      try {
        const page = await d.getPage(idx);
        if (seq !== renderSeqRef.current) return;

        const canvas = document.createElement('canvas');
        const renderViewport = dpr === 1 ? viewport : page.getViewport({ scale: zoom * dpr });
        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        wrap.appendChild(canvas);

        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = `textLayer ${styles.textLayer}`;
        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.height = viewport.height + 'px';
        wrap.appendChild(textLayerDiv);

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        try {
          await page.render({ canvas, canvasContext: ctx, viewport: renderViewport }).promise;
        } catch {
          /* aborted by zoom change */
        }

        try {
          const textContent = await page.getTextContent();
          const tl = new TextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport,
          });
          await tl.render();
        } catch (e) {
          console.warn('text layer render failed for page', idx, e);
        }

        slot.rendered = true;
        // Re-apply highlights for this newly-painted page.
        if (findQuery) applyHighlights();
      } finally {
        slot.rendering = false;
      }
    }

    function unpaint(wrap: HTMLDivElement) {
      const slot = slots.get(wrap);
      if (!slot || !slot.rendered) return;
      // Drop heavy children (canvas + textLayer) but preserve the wrapper's
      // dimensions so scroll position stays stable.
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      slot.rendered = false;
    }

    // Phase 2: observe & swap heavy DOM in/out as users scroll.
    // Margin of ~one viewport keeps adjacent pages ready, so quick scrolls
    // feel instant without holding the whole document in memory.
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const wrap = entry.target as HTMLDivElement;
          const meta = pages.find(p => p.wrap === wrap);
          if (!meta) continue;
          if (entry.isIntersecting) {
            void paint(meta.index, wrap, meta.viewport);
          } else {
            // Only unpaint when we're well clear of the viewport. The observer
            // fires with isIntersecting=false the moment any edge crosses,
            // which is too aggressive for fast scrolls.
            const rect = entry.boundingClientRect;
            const root = entry.rootBounds;
            if (root && (rect.bottom < root.top - root.height || rect.top > root.bottom + root.height)) {
              unpaint(wrap);
            }
          }
        }
      },
      {
        root: container,
        rootMargin: '300px 0px 300px 0px',
      },
    );
    for (const p of pages) observer.observe(p.wrap);
    observerRef.current?.disconnect();
    observerRef.current = observer;
    // Restore scroll now that layout is committed. Clamp so we don't overshoot
    // when a shorter document replaced a longer one.
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = Math.min(savedScrollTop, maxTop);
    container.scrollLeft = savedScrollLeft;
    // Fast path: paint the page under the current scroll position immediately
    // rather than waiting for the observer's next microtask. Cuts perceived
    // compile→visible latency by ~1 frame on recompile.
    const probeY = container.scrollTop + container.clientHeight / 3;
    for (const p of pages) {
      const top = p.wrap.offsetTop;
      const bot = top + p.wrap.offsetHeight;
      if (probeY >= top && probeY < bot) {
        void paint(p.index, p.wrap, p.viewport);
        break;
      }
    }
  }, [zoom, findQuery, applyHighlights]);

  // Honor external scroll requests (forward SyncTeX: editor line → PDF spot).
  useEffect(() => {
    if (!scrollRequest) return;
    const container = containerRef.current;
    if (!container) return;
    const wrap = container.querySelector<HTMLDivElement>(
      `.${styles.page}[data-page="${scrollRequest.page}"]`,
    );
    if (!wrap) return;
    // SyncTeX y is in PDF points (72 dpi); page DOM is CSS px (96 dpi) × zoom.
    const yPx = scrollRequest.y != null ? scrollRequest.y * zoom * (96 / 72) : 0;
    container.scrollTop = Math.max(0, wrap.offsetTop + yPx - container.clientHeight / 3);
    setCurrentPage(scrollRequest.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

  function onScroll() {
    const container = containerRef.current;
    const doc = docRef.current;
    if (!container || !doc) return;
    const top = container.scrollTop;
    const probe = top + container.clientHeight / 3;
    const pages = container.querySelectorAll<HTMLDivElement>(`.${styles.page}`);
    for (const w of pages) {
      const offTop = w.offsetTop;
      const offBot = offTop + w.offsetHeight;
      if (probe >= offTop && probe < offBot) {
        const n = Number(w.dataset.page) || 1;
        if (n !== currentPage) setCurrentPage(n);
        break;
      }
    }
  }

  function onWheel(e: React.WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (e.deltaY < 0) setZoom(Math.min(4, zoom + 0.1));
    else setZoom(Math.max(0.5, zoom - 0.1));
  }

  function onPageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onSyncTexBackward) return;
    // Don't fire SyncTeX if the user is selecting text — let the selection happen.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const target = e.target as HTMLElement;
    const wrap = target.closest<HTMLDivElement>(`.${styles.page}`);
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const page = Number(wrap.dataset.page) || 1;
    // SyncTeX expects PDF points (72 dpi); page CSS pixels are 96 dpi × zoom.
    const cssToPt = 72 / 96;
    onSyncTexBackward(page, (x / zoom) * cssToPt, (y / zoom) * cssToPt);
  }

  function scrollToPage(n: number) {
    const container = containerRef.current;
    if (!container) return;
    const wrap = container.querySelector<HTMLDivElement>(`.${styles.page}[data-page="${n}"]`);
    if (wrap) container.scrollTop = wrap.offsetTop;
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <button
          className={styles.btn}
          onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
          disabled={!numPages || currentPage <= 1}
        >
          ←
        </button>
        <span className={styles.info}>
          {numPages ? `${currentPage} / ${numPages}` : '— / —'}
        </span>
        <button
          className={styles.btn}
          onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))}
          disabled={!numPages || currentPage >= numPages}
        >
          →
        </button>
        <span className={styles.divider} />
        <button className={styles.btn} onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}>
          −
        </button>
        <span className={styles.info}>{Math.round(zoom * 100)}%</span>
        <button className={styles.btn} onClick={() => setZoom(Math.min(4, zoom + 0.25))}>
          +
        </button>
        <span className={styles.divider} />
        <button
          className={styles.btn}
          onClick={() => (findOpen ? closeFinder() : openFinder())}
          disabled={!bytes}
          title="Find in PDF (Ctrl+F)"
        >
          <IconSearch size={13} />
        </button>
      </div>

      {findOpen && (
        <div className={styles.finder}>
          <input
            ref={findInputRef}
            type="text"
            className={styles.finderInput}
            value={findQuery}
            onChange={e => setFindQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                closeFinder();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                gotoMatch(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Find in PDF…"
          />
          <span className={styles.finderInfo}>
            {findQuery ? (findCount ? `${findIndex + 1}/${findCount}` : '0/0') : ''}
          </span>
          <button
            className={styles.btn}
            onClick={() => gotoMatch(-1)}
            disabled={!findCount}
            title="Previous (Shift+Enter)"
          >
            ↑
          </button>
          <button
            className={styles.btn}
            onClick={() => gotoMatch(1)}
            disabled={!findCount}
            title="Next (Enter)"
          >
            ↓
          </button>
          <label className={styles.finderCheckbox} title="Match case">
            <input
              type="checkbox"
              checked={findCase}
              onChange={e => setFindCase(e.target.checked)}
            />
            Aa
          </label>
          <button className={styles.btn} onClick={closeFinder} title="Close (Esc)">
            ×
          </button>
        </div>
      )}

      {/* The scroll container must stay mounted even while an error or the
        * empty state is showing — renderAll() writes into containerRef, and a
        * remount between a failed load and the next successful one would leave
        * the viewer permanently blank. Overlays sit on top instead. */}
      <div className={styles.body}>
        <div
          ref={containerRef}
          className={`${styles.pages} ${pdfDarkMode === 'invert' ? styles.invert : ''} ${pdfDarkMode === 'sepia' ? styles.sepia : ''}`}
          style={pdfBg ? { background: pdfBg } : undefined}
          onScroll={onScroll}
          onWheel={onWheel}
          onClick={onPageClick}
        />
        {error ? (
          <div className={styles.overlay}>
            <div className={styles.error}>{error}</div>
          </div>
        ) : !bytes ? (
          <div className={styles.overlay}>
            <div className={styles.empty}>(no PDF — compile to render)</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
