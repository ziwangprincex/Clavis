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
import { PdfPages, type PdfGrading } from '../pdf/pages';
import { bindPreviewZoom, capturePageAnchor, type ZoomPoint } from '../pdf/zoom';
import { ensurePdfjs } from '../pdf/pdfjs';
import { ipc } from '../api/tauri';
import { IconSearch } from './icons';
import { usePdfStore, useSettingsStore, useTabsStore, useCompileStore, type Settings } from '../store';
import { headlineProblem } from '../store/compile';
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
  /** The PDF window: shows whatever PDF it was sent, with no document of its own. */
  standalone?: boolean;
  /** Offer to show the PDF in its own window. */
  onDetach?: () => void;
}

// pdf.js shares one worker and rejects getDocument() while any document on it
// is still being destroyed, so every destroy is tracked and loads wait for them.
let releasing: Promise<unknown> = Promise.resolve();
function release(target: { destroy(): Promise<void> } | null | undefined) {
  if (target) releasing = Promise.all([releasing, target.destroy().catch(() => {})]);
}

/** Zoom that fits the widest page inside the pane's 24px padding, never above
 *  100%. Border-box width, so a scrollbar appearing cannot feed back into it. */
/** A 16 px stroke icon for the viewer toolbar. */
function ToolIcon({ d }: { d: string }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

/** The zoom that fits a page (or two side by side, with their gap) to the pane's width. */
function fitZoom(host: HTMLElement, pageWidth: number, spread = false) {
  const room = host.offsetWidth - 48 - 12 - (spread ? 24 : 0);
  return Math.round(Math.max(0.3, Math.min(1, room / (pageWidth * (spread ? 2 : 1)))) * 100) / 100;
}

export function PdfViewer({ onSyncTexBackward, visible = true, onCompile, onEnvironment, onProblems, standalone = false, onDetach }: PdfViewerProps) {
  const activeTab = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const pdf = usePdfStore();
  const bytes = standalone || belongsToPdf(activeTab, pdf) ? pdf.bytes : null;
  const compileStatus = useCompileStore(s => s.status);
  const compileError = useCompileStore(s => headlineProblem(s.errors));
  const compiling = compileStatus === 'compiling';
  const zoom = usePdfStore(s => s.zoom);
  const fit = usePdfStore(s => s.fit);
  const setZoom = usePdfStore(s => s.setZoom);
  const setNumPages = usePdfStore(s => s.setNumPages);
  const setCurrentPage = usePdfStore(s => s.setCurrentPage);
  const numPages = usePdfStore(s => s.numPages);
  const currentPage = usePdfStore(s => s.currentPage);
  const scrollRequest = usePdfStore(s => s.scrollRequest);

  const pdfDarkMode = useSettingsStore(s => s.settings.pdf_dark_mode);
  const spread = useSettingsStore(s => s.settings.pdf_spread);
  const scrollLock = useSettingsStore(s => s.settings.pdf_scroll_lock);
  const patchAndSave = useSettingsStore(s => s.patchAndSave);
  // The PDF window does not write settings: the main window owns the file and would overwrite them.
  const patchSettings = standalone
    ? async (patch: Partial<Settings>) => useSettingsStore.setState(state => ({ settings: { ...state.settings, ...patch } }))
    : patchAndSave;
  const spreadRef = useRef(spread);
  spreadRef.current = spread;
  const grading: PdfGrading = pdfDarkMode === 'dark' ? 'colors' : pdfDarkMode === 'dark-images' ? 'images' : 'off';
  const gradingRef = useRef(grading);
  gradingRef.current = grading;

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
  /** The page number being typed, while the page field has focus. */
  const [pageDraft, setPageDraft] = useState<string | null>(null);

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

  useEffect(() => { pagesRef.current?.setGrading(grading); }, [grading]);

  // Until the reader zooms, the page follows the pane: Split, the splitter and
  // window resizes all keep a whole page width in view.
  useEffect(() => {
    const host = containerRef.current;
    if (!host || !visible || !fit) return;
    const observer = new ResizeObserver(() => {
      const width = pagesRef.current?.widest;
      if (width) usePdfStore.setState({ zoom: fitZoom(host, width, spreadRef.current) });
    });
    observer.observe(host, { box: 'border-box' });
    return () => observer.disconnect();
  }, [visible, fit, spread]);

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
        release(previous);
        host.replaceChildren();
        setSearchDoc(null);
        setNumPages(0);
        setCurrentPage(1);
        setError(null);
        return;
      }
      try {
        await releasing;
        if (cancelled) return;
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
          gradingRef.current,
        );
        await candidate.prepare();
        if (cancelled) return;
        pagesRef.current?.destroy();
        const previous = docRef.current;
        if (usePdfStore.getState().fit) {
          zoomRef.current = fitZoom(host, candidate.widest, spreadRef.current);
          usePdfStore.setState({ zoom: zoomRef.current });
        }
        candidate.attach(zoomRef.current);
        pagesRef.current = candidate;
        docRef.current = candidateDoc;
        attachedBytesRef.current = bytes;
        setSearchDoc(candidateDoc);
        candidate = undefined;
        candidateDoc = undefined;
        release(previous);
        setNumPages(docRef.current.numPages);
        setCurrentPage(Math.min(usePdfStore.getState().currentPage, docRef.current.numPages));
        applyPendingScroll();
        setError(null);
      } catch (error) {
        candidate?.destroy();
        if (!cancelled) {
          release(loading);
          setError(String(error));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      candidate?.destroy();
      if (!docRef.current || docRef.current.loadingTask !== loading) release(loading);
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
      release(previous);
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
        {/* Zoom on the left, pages in the middle, tools on the right, as Texifier's viewer bar. */}
        <div className={styles.group}>
          <button className={styles.btn} aria-pressed={spread} title={t('Two pages side by side')} aria-label={t('Two pages side by side')}
            onClick={() => void patchSettings({ pdf_spread: !spread })}>
            <ToolIcon d="M2 3h4.5v10H2zM9.5 3H14v10H9.5z" />
          </button>
          <span className={styles.divider} />
          <button className={styles.btn} aria-label={t("Zoom out")} title={t("Zoom out")} onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}>
            <ToolIcon d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14M4.8 7h4.4" />
          </button>
          <button className={`${styles.btn} ${styles.info}`} aria-pressed={fit} title={t("Fit width")}
            onClick={() => usePdfStore.setState({ fit: true })}>
            {Math.round(zoom * 100)}%
          </button>
          <button className={styles.btn} aria-label={t("Zoom in")} title={t("Zoom in")} onClick={() => setZoom(Math.min(4, zoom + 0.25))}>
            <ToolIcon d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14M4.8 7h4.4M7 4.8v4.4" />
          </button>
        </div>
        <div className={`${styles.group} ${styles.pagesGroup}`}>
          <button className={styles.btn} onClick={() => scrollToPage(1)} disabled={!numPages || currentPage <= 1} aria-label={t("First page")} title={t("First page")}>
            <ToolIcon d="M9 4 5 8l4 4M13 4 9 8l4 4" />
          </button>
          <button className={styles.btn} onClick={() => scrollToPage(Math.max(1, currentPage - 1))} disabled={!numPages || currentPage <= 1} aria-label={t("Previous page")} title={t("Previous page")}>
            <ToolIcon d="M10 4 6 8l4 4" />
          </button>
          {/* Type a page and press Enter, as in Texifier's toolbar; leaving the field discards it. */}
          <span className={styles.pageLabel}>
            <input
              className={styles.pageInput}
              aria-label={t("Page number")}
              disabled={!numPages}
              value={pageDraft ?? (numPages ? String(currentPage) : '—')}
              onFocus={event => { setPageDraft(String(currentPage)); event.currentTarget.select(); }}
              onChange={event => setPageDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  const page = Number.parseInt(pageDraft ?? '', 10);
                  if (page) scrollToPage(Math.min(numPages, Math.max(1, page)));
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') event.currentTarget.blur();
              }}
              onBlur={() => setPageDraft(null)}
            />
            <span>{t('of {count}', { count: numPages || '—' })}</span>
          </span>
          <button className={styles.btn} onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))} disabled={!numPages || currentPage >= numPages} aria-label={t("Next page")} title={t("Next page")}>
            <ToolIcon d="m6 4 4 4-4 4" />
          </button>
          <button className={styles.btn} onClick={() => scrollToPage(numPages)} disabled={!numPages || currentPage >= numPages} aria-label={t("Last page")} title={t("Last page")}>
            <ToolIcon d="m3 4 4 4-4 4M7 4l4 4-4 4" />
          </button>
        </div>
        <div className={`${styles.group} ${styles.toolsGroup}`}>
          {activeTab?.lang === 'latex' && <button className={styles.btn} aria-pressed={scrollLock}
            title={t('Follow the editor: the PDF scrolls with the source')} aria-label={t('Follow the editor: the PDF scrolls with the source')}
            onClick={() => void patchSettings({ pdf_scroll_lock: !scrollLock })}>
            <ToolIcon d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v6.5H4z" />
          </button>}
          {onDetach && <button className={styles.btn} title={t('Show the PDF in its own window')} aria-label={t('Show the PDF in its own window')} onClick={onDetach}>
            <ToolIcon d="M2 5v8.5h8.5M5 2h9v8.5H5z" />
          </button>}
          <button
            className={styles.btn}
            onClick={() => (findOpen ? closeFinder() : openFinder())}
            disabled={!bytes}
            aria-pressed={findOpen}
            title={`${t('Find in PDF')} (${fmtShortcut('Ctrl+F')})`}
            aria-label={t("Find in PDF")}
          >
            <IconSearch size={14} />
          </button>
        </div>
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
        {(compiling || pdf.stale) && bytes && <div className={styles.updateNotice} role="status">{compiling ? t("Updating preview") : t("Preview not updated")} {t("· showing the last successful render")}</div>}
        <div
          ref={containerRef}
          className={`${styles.pages} ${pdfDarkMode === 'invert' ? styles.invert : ''} ${pdfDarkMode === 'sepia' ? styles.sepia : ''} ${grading !== 'off' ? styles.darkPaper : ''} ${spread ? styles.spread : ''}`}
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
                ? t('Compilation failed: {message}', { message: compileError ?? t('Details are listed under Problems.') })
                : t("The preview appears after the LaTeX document is compiled.")}</span>
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
