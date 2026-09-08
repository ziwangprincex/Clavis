// PdfViewer — continuous-scroll PDF viewer using pdfjs-dist.
//
// - Renders each page to a canvas + a transparent text layer on top so users
//   can select text AND we can highlight search matches.
// - SyncTeX reverse search: clicking a page surface (without selecting text)
//   reports (page, xPoints, yPoints) up via onSyncTexBackward.
// - Text search (Ctrl+F): indexes all pages independently of virtualized
//   surfaces; mounted text layers display the matching fragments.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { PdfPages } from '../pdf/pages';
import { bindPreviewZoom, capturePageAnchor, type ZoomPoint } from '../pdf/zoom';
import { ensurePdfjs } from '../pdf/pdfjs';
import { IconSearch } from './icons';
import { usePdfStore, useSettingsStore, useTabsStore, useCompileStore } from '../store';
import { usePdfSearch } from '../hooks/usePdfSearch';
import { fmtShortcut } from '../platform';
import { belongsToPdf } from '../compile/target';
// We import a minimal subset of pdfjs's textLayer CSS — see ../pdf/textLayer.css.
import '../pdf/textLayer.css';
import styles from './PdfViewer.module.css';

export interface PdfViewerProps {
  visible?: boolean;
  onSyncTexBackward?: (page: number, x: number, y: number) => void;
}

export function PdfViewer({ onSyncTexBackward, visible = true }: PdfViewerProps) {
  const activeTab = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const pdf = usePdfStore();
  const bytes = belongsToPdf(activeTab, pdf) ? pdf.bytes : null;
  const compileStatus = useCompileStore(s => s.status);
  const compileError = useCompileStore(s => s.errors[0]?.message);
  const compiling = compileStatus === 'compiling';
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
  const pagesRef = useRef<PdfPages | null>(null);
  const zoomRef = useRef(zoom);
  const zoomPoint = useRef<ZoomPoint>();
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [searchDoc, setSearchDoc] = useState<PDFDocumentProxy | null>(null);

  // Search the attached document, not an in-flight candidate or hidden viewer.
  const {
    findOpen,
    findQuery,
    findCase,
    findCount,
    findIndex,
    searching,
    searchError,
    findInputRef,
    setFindQuery,
    setFindCase,
    applyHighlights,
    openFinder,
    closeFinder,
    gotoMatch,
  } = usePdfSearch(containerRef, visible && bytes ? searchDoc : null);

  const highlightRef = useRef(applyHighlights);
  highlightRef.current = applyHighlights;
  zoomRef.current = zoom;

  useEffect(() => {
    const host = containerRef.current;
    if (!host || !visible) return;
    return bindPreviewZoom(host, () => zoomRef.current, (value, point) => {
      zoomPoint.current = point;
      zoomRef.current = value;
      setZoom(value);
    });
  }, [visible, setZoom]);

  useLayoutEffect(() => {
    pagesRef.current?.setZoom(zoom, zoomPoint.current);
    zoomPoint.current = undefined;
  }, [zoom]);

  // Keep the last successful pages visible while new bytes load. A candidate
  // owns its render tasks until attach; hide/tab switch cancels it immediately.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let candidate: PdfPages | undefined;
    let candidateDoc: PDFDocumentProxy | undefined;
    let loading: PDFDocumentLoadingTask | undefined;
    async function load() {
      const host = containerRef.current;
      if (!host) return;
      if (!bytes) {
        pagesRef.current?.destroy();
        pagesRef.current = null;
        const previous = docRef.current;
        docRef.current = null;
        if (previous) void previous.destroy();
        host.replaceChildren();
        setSearchDoc(null);
        setNumPages(0);
        setCurrentPage(1);
        setError(null);
        return;
      }
      try {
        loading = ensurePdfjs().getDocument({ data: new Uint8Array(bytes) });
        candidateDoc = await loading.promise;
        if (cancelled) return;
        candidate = new PdfPages(
          host, candidateDoc, zoomRef.current,
          () => highlightRef.current(),
          error => { if (!cancelled) setError(String(error)); },
        );
        await candidate.prepare();
        if (cancelled) return;
        pagesRef.current?.destroy();
        const previous = docRef.current;
        candidate.attach(zoomRef.current);
        pagesRef.current = candidate;
        docRef.current = candidateDoc;
        setSearchDoc(candidateDoc);
        candidate = undefined;
        candidateDoc = undefined;
        if (previous) void previous.destroy();
        setNumPages(docRef.current.numPages);
        setCurrentPage(Math.min(usePdfStore.getState().currentPage, docRef.current.numPages));
        setError(null);
      } catch (error) {
        candidate?.destroy();
        if (!cancelled) {
          void loading?.destroy();
          setError(String(error));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      candidate?.destroy();
      if (!docRef.current || docRef.current.loadingTask !== loading) void loading?.destroy();
    };
  }, [bytes, visible, retry, setNumPages, setCurrentPage]);

  useEffect(() => {
    if (!visible) {
      setSearchDoc(null);
      pagesRef.current?.destroy();
      pagesRef.current = null;
    }
    return () => {
      pagesRef.current?.destroy();
      pagesRef.current = null;
      const previous = docRef.current;
      docRef.current = null;
      if (previous) void previous.destroy();
    };
  }, [visible]);

  // Honor external scroll requests (forward SyncTeX: editor line → PDF spot).
  useEffect(() => {
    if (!scrollRequest) return;
    const container = containerRef.current;
    if (!container) return;
    const wrap = container.querySelector<HTMLDivElement>(
      `.${styles.page}[data-page="${scrollRequest.page}"]`,
    );
    if (!wrap) return;
    // PDF.js viewport scale 1 maps one PDF point to one CSS pixel.
    const yPx = scrollRequest.y != null ? scrollRequest.y * zoom : 0;
    container.scrollTop = Math.max(0, wrap.offsetTop + yPx - container.clientHeight / 3);
    setCurrentPage(scrollRequest.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

  function onScroll() {
    const container = containerRef.current;
    const doc = docRef.current;
    if (!container || !doc) return;
    const box = container.getBoundingClientRect();
    const anchor = capturePageAnchor(container, pagesRef.current?.elements ?? [], {
      x: box.left + container.clientWidth / 2,
      y: box.top + container.clientHeight / 3,
    });
    if (anchor && anchor.index + 1 !== currentPage) setCurrentPage(anchor.index + 1);
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
    onSyncTexBackward(page, x / zoom, y / zoom);
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
          aria-label="Previous page"
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
          aria-label="Next page"
        >
          →
        </button>
        <span className={styles.divider} />
        <button className={styles.btn} aria-label="Zoom out" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}>
          −
        </button>
        <span className={styles.info}>{Math.round(zoom * 100)}%</span>
        <button className={styles.btn} aria-label="Zoom in" onClick={() => setZoom(Math.min(4, zoom + 0.25))}>
          +
        </button>
        <span className={styles.divider} />
        <button
          className={styles.btn}
          onClick={() => (findOpen ? closeFinder() : openFinder())}
          disabled={!bytes}
          title={`Find in PDF (${fmtShortcut('Ctrl+F')})`}
          aria-label="Find in PDF"
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
          <span className={styles.finderInfo} aria-live="polite" title={searchError ?? undefined}>
            {searchError ? 'Search failed' : searching ? 'Searching…'
              : findQuery ? (findCount ? `${findIndex + 1}/${findCount}` : '0/0') : ''}
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
        * empty state is showing — PdfPages writes into containerRef, and a
        * remount between a failed load and the next successful one would leave
        * the viewer permanently blank. Overlays sit on top instead. */}
      <div className={styles.body} aria-busy={compiling}>
        {(compiling || pdf.stale) && bytes && <div className={styles.updateNotice} role="status">{compiling ? "Updating preview" : "Preview not updated"} · showing last successful render</div>}
        <div
          ref={containerRef}
          className={`${styles.pages} ${pdfDarkMode === 'invert' ? styles.invert : ''} ${pdfDarkMode === 'sepia' ? styles.sepia : ''}`}
          style={pdfBg ? { background: pdfBg } : undefined}
          onScroll={onScroll}
          onClick={onPageClick}
        />
        {error ? (
          <div className={styles.overlay}>
            <div className={styles.error} role="alert">
              <span>Could not display PDF: {error}</span>
              <button className={styles.btn} onClick={() => setRetry(n => n + 1)}>Reload preview</button>
            </div>
          </div>
        ) : !bytes ? (
          <div className={styles.overlay}>
            <div className={styles.empty} role="status">
              {compiling ? 'Compiling LaTeX…' : compileStatus === 'error'
                ? `Compilation failed: ${compileError ?? 'See problems for details.'}`
                : 'Compile your LaTeX document to show the preview.'}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
