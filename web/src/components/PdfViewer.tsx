import { t } from '../i18n';
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
import { ipc } from '../api/tauri';
import { IconSearch } from './icons';
import { usePdfStore, useSettingsStore, useTabsStore, useCompileStore } from '../store';
import { usePdfSearch } from '../hooks/usePdfSearch';
import { fmtShortcut } from '../platform';
import { belongsToPdf } from '../compile/target';
import { guidance } from '../compile/guidance';
// We import a minimal subset of pdfjs's textLayer CSS — see ../pdf/textLayer.css.
import '../pdf/textLayer.css';
import styles from './PdfViewer.module.css';

export interface PdfViewerProps {
  visible?: boolean;
  onCompile?: () => void;
  onEnvironment?: () => void;
  onProblems?: () => void;
  onSyncTexBackward?: (page: number, x: number, y: number) => void;
}

export function PdfViewer({ onSyncTexBackward, visible = true, onCompile, onEnvironment, onProblems }: PdfViewerProps) {
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

  const pdfDarkMode = useSettingsStore(s => s.settings.pdf_dark_mode);

  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pagesRef = useRef<PdfPages | null>(null);
  const attachedBytesRef = useRef<Uint8Array | null>(null);
  const handledScrollRef = useRef<number | null>(null);
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
        attachedBytesRef.current = null;
        handledScrollRef.current = usePdfStore.getState().scrollRequest?.seq ?? null;
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
          target => {
            if (target.kind === 'page') usePdfStore.getState().requestScroll(target.page, target.y);
            else void ipc.openExternalUrl(target.url).catch(error => console.warn('Could not open link', error));
          },
        );
        await candidate.prepare();
        if (cancelled) return;
        pagesRef.current?.destroy();
        const previous = docRef.current;
        candidate.attach(zoomRef.current);
        pagesRef.current = candidate;
        docRef.current = candidateDoc;
        attachedBytesRef.current = bytes;
        setSearchDoc(candidateDoc);
        candidate = undefined;
        candidateDoc = undefined;
        if (previous) void previous.destroy();
        setNumPages(docRef.current.numPages);
        setCurrentPage(Math.min(usePdfStore.getState().currentPage, docRef.current.numPages));
        applyPendingScroll();
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
      attachedBytesRef.current = null;
      if (previous) void previous.destroy();
    };
  }, [visible]);

  // A jump can arrive before the first page attaches, or while Write hides it.
  // Consume it once on a matching attached PDF, not on stale page wrappers.
  function applyPendingScroll() {
    const request = usePdfStore.getState().scrollRequest;
    const container = containerRef.current;
    if (!visible || !bytes || attachedBytesRef.current !== bytes || !request || !container
      || request.seq === handledScrollRef.current) return;
    const wrap = container.querySelector<HTMLDivElement>(
      `.${styles.page}[data-page="${request.page}"]`,
    );
    if (!wrap) return;
    const yPx = request.y != null ? request.y * zoomRef.current : 0;
    container.scrollTop = Math.max(0, wrap.offsetTop + yPx - container.clientHeight / 3);
    handledScrollRef.current = request.seq;
    setCurrentPage(request.page);
  }

  useEffect(() => {
    applyPendingScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest, visible]);

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
          aria-label={t("Previous page")}
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
          aria-label={t("Next page")}
        >
          →
        </button>
        <span className={styles.divider} />
        <button className={styles.btn} aria-label={t("Zoom out")} onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}>
          −
        </button>
        <span className={styles.info}>{Math.round(zoom * 100)}%</span>
        <button className={styles.btn} aria-label={t("Zoom in")} onClick={() => setZoom(Math.min(4, zoom + 0.25))}>
          +
        </button>
        <span className={styles.divider} />
        <button
          className={styles.btn}
          onClick={() => (findOpen ? closeFinder() : openFinder())}
          disabled={!bytes}
          title={`Find in PDF (${fmtShortcut('Ctrl+F')})`}
          aria-label={t("Find in PDF")}
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
            placeholder={t("Find in PDF…")}
          />
          <span className={styles.finderInfo} aria-live="polite" title={searchError ?? undefined}>
            {searchError ? t("Search failed") : searching ? t("Searching…")
              : findQuery ? (findCount ? `${findIndex + 1}/${findCount}` : '0/0') : ''}
          </span>
          <button
            className={styles.btn}
            onClick={() => gotoMatch(-1)}
            disabled={!findCount}
            title={t("Previous (Shift+Enter)")}
          >
            ↑
          </button>
          <button
            className={styles.btn}
            onClick={() => gotoMatch(1)}
            disabled={!findCount}
            title={t("Next (Enter)")}
          >
            ↓
          </button>
          <label className={styles.finderCheckbox} title={t("Match case")}>
            <input
              type="checkbox"
              checked={findCase}
              onChange={e => setFindCase(e.target.checked)}
            />
            Aa
          </label>
          <button className={styles.btn} onClick={closeFinder} title={t("Close (Esc)")}>
            ×
          </button>
        </div>
      )}

      {/* The scroll container must stay mounted even while an error or the
        * empty state is showing — PdfPages writes into containerRef, and a
        * remount between a failed load and the next successful one would leave
        * the viewer permanently blank. Overlays sit on top instead. */}
      <div className={styles.body} aria-busy={compiling}>
        {(compiling || pdf.stale) && bytes && <div className={styles.updateNotice} role="status">{compiling ? t("Updating preview") : t("Preview not updated")} {t("· showing last successful render")}</div>}
        <div
          ref={containerRef}
          className={`${styles.pages} ${pdfDarkMode === 'invert' ? styles.invert : ''} ${pdfDarkMode === 'sepia' ? styles.sepia : ''}`}
          onScroll={onScroll}
          onClick={onPageClick}
        />
        {error ? (
          <div className={styles.overlay}>
            <div className={styles.error} role="alert">
              <span>{t("Could not display PDF:")} {error}</span>
              <button className={styles.btn} onClick={() => setRetry(n => n + 1)}>{t("Reload preview")}</button>
            </div>
          </div>
        ) : !bytes ? (
          <div className={styles.overlay}>
            <div className={styles.empty} role="status">
              <span>{compiling ? t("Compiling LaTeX…") : compileStatus === 'error'
                ? t('Compilation failed: {message}', { message: compileError ?? t('See problems for details.') })
                : t("Compile your LaTeX document to show the preview.")}</span>
              {!compiling && <div className={styles.emptyActions}>
                {onCompile && <button className={styles.btn} onClick={onCompile}>{compileStatus === 'error' ? t('Try compiling again') : t('Compile')}</button>}
                {compileStatus === 'error' && onProblems && <button className={styles.btn} onClick={onProblems}>{t('Show problems')}</button>}
                {(compileStatus !== 'error' || guidance('latex', compileError ?? '').action === 'environment') && onEnvironment && <button className={styles.btn} onClick={onEnvironment}>{t('Check environment')}</button>}
              </div>}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
