import { t } from '../i18n';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { TypstPage } from '../api/tauri';
import styles from './TypstReader.module.css';
// The controls are the PDF viewer's, so the two previews float the same capsules.
import controls from './PdfViewer.module.css';
import { IconSearch } from './icons';
import { fmtShortcut } from '../platform';
import { findReadingMatches, type ReadingMatch } from '../compile/readingText';
import { bindPreviewZoom, capturePageAnchor, restorePageAnchor, type ZoomPoint } from '../pdf/zoom';

type Navigate = (path: string | null, line: number) => void;
/** A 16 px stroke icon, as the PDF viewer draws them. */
function ToolIcon({ d }: { d: string }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
const ZOOM_MIN = 50;
const ZOOM_MAX = 400;
const pageElements = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[data-page]'));
const ReaderPage = memo(function ReaderPage({
  page,
  index,
  scroll,
  stale,
  highlights,
  goto,
  onNavigate,
}: {
  page: TypstPage;
  index: number;
  scroll: RefObject<HTMLDivElement>;
  stale: boolean;
  highlights: number[];
  goto: (page: number, y?: number) => void;
  onNavigate?: Navigate;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(index < 2);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => setMounted(entries[0].isIntersecting), {
      root: scroll.current,
      rootMargin: '1000px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scroll]);
  return (
    <div
      ref={ref}
      data-page={index}
      className={styles.page}
      style={{ aspectRatio: `${page.width}/${page.height}` }}
      onDoubleClick={(event) => {
        if (stale || !onNavigate || !window.getSelection()?.isCollapsed) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - rect.left) * page.width) / rect.width,
          y = ((event.clientY - rect.top) * page.height) / rect.height;
        let best = page.points[0],
          distance = Infinity;
        for (const p of page.points) {
          const d = (p.x - x) ** 2 + 4 * (p.y - y) ** 2;
          if (d < distance) {
            best = p;
            distance = d;
          }
        }
        if (best) onNavigate(best.file, best.line);
      }}
    >
      {mounted && (
        <>
          <div
            aria-hidden="true"
            className={styles.art}
            dangerouslySetInnerHTML={{ __html: page.svg }}
          />
          <svg
            className={styles.text}
            viewBox={`0 0 ${page.width} ${page.height}`}
            aria-label={`Page ${index + 1}`}
          >
            {page.text.map((run, i) => (
              <text
                key={i}
                transform={`matrix(${run.matrix.join(' ')})`}
                textLength={run.width || undefined}
                lengthAdjust="spacingAndGlyphs"
                fontSize={run.size}
                className={highlights.includes(i) ? styles.hit : ''}
              >
                {run.text}
              </text>
            ))}
            {page.links.map((link, i) => (
              <a
                key={i}
                href={`#page-${link.page}`}
                aria-label={`Go to page ${link.page}`}
                onClick={(event) => {
                  event.preventDefault();
                  goto(link.page - 1, link.target_y);
                }}
              >
                <rect
                  x={link.x}
                  y={link.y}
                  width={link.width}
                  height={link.height}
                  fill="transparent"
                />
              </a>
            ))}
          </svg>
        </>
      )}
    </div>
  );
});

export function TypstReader({
  pages,
  scroll,
  stale,
  onNavigate,
  children,
}: {
  pages: TypstPage[];
  scroll: RefObject<HTMLDivElement>;
  stale: boolean;
  onNavigate?: Navigate;
  /** Preview status and actions, at the end of the toolbar. */
  children?: ReactNode;
}) {
  const [zoom, setZoom] = useState(100),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(''),
    [match, setMatch] = useState(0),
    [findOpen, setFindOpen] = useState(false);
  const findInput = useRef<HTMLInputElement>(null);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const hits = useMemo(() => findReadingMatches(pages, query), [pages, query]);
  const highlights = useMemo(() => {
    const byPage: number[][] = pages.map(() => []);
    for (const hit of hits) byPage[hit.page].push(...hit.runs);
    return byPage;
  }, [pages, hits]);
  const goto = useCallback(
    (index: number, y = 0) => {
      const bounded = Math.max(0, Math.min(pages.length - 1, index));
      const element = scroll.current?.querySelector<HTMLElement>(`[data-page="${bounded}"]`);
      if (element && scroll.current) {
        scroll.current.scrollTop =
          element.offsetTop + (y / pages[bounded].height) * element.clientHeight - 48;
        setPage(bounded + 1);
      }
    },
    [pages, scroll],
  );
  const searchedQuery = useRef('');
  const selectedHit = useRef<ReadingMatch & { index: number }>();
  useEffect(() => {
    const changed = searchedQuery.current !== query;
    searchedQuery.current = query;
    if (changed) {
      setMatch(0);
      selectedHit.current = hits.length ? { ...hits[0], index: 0 } : undefined;
      if (hits.length) goto(hits[0].page, pages[hits[0].page].text[hits[0].runs[0]]?.matrix[5]);
    } else {
      const previous = selectedHit.current;
      const same = hits.findIndex(hit => hit.page === previous?.page && hit.from === previous.from);
      const next = same >= 0 ? same : Math.min(previous?.index ?? 0, Math.max(0, hits.length - 1));
      selectedHit.current = hits.length ? { ...hits[next], index: next } : undefined;
      setMatch(next);
      // Recompilation updates highlights/counts, never the reading position.
    }
  }, [hits, goto, pages, query]);
  function find(index: number) {
    if (!hits.length) return;
    const next = (index + hits.length) % hits.length;
    setMatch(next);
    selectedHit.current = { ...hits[next], index: next };
    goto(hits[next].page, pages[hits[next].page].text[hits[next].runs[0]]?.matrix[5]);
  }
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const anchor = useRef<ReturnType<typeof capturePageAnchor>>(null);
  const resize = useCallback(
    (value: number, point?: ZoomPoint) => {
      if (value === zoomRef.current || !scroll.current) return;
      anchor.current = capturePageAnchor(scroll.current, pageElements(scroll.current), point);
      zoomRef.current = value;
      setZoom(value);
    },
    [scroll],
  );
  useLayoutEffect(() => {
    if (scroll.current) restorePageAnchor(scroll.current, pageElements(scroll.current), anchor.current);
    anchor.current = null;
  }, [zoom, scroll]);
  useEffect(() => {
    const host = scroll.current;
    if (!host) return;
    return bindPreviewZoom(host, () => zoomRef.current, resize, ZOOM_MIN, ZOOM_MAX);
  }, [scroll, resize]);
  useEffect(() => {
    const host = scroll.current;
    if (!host) return;
    let frame = 0;
    const elements = pageElements(host);
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = host.getBoundingClientRect();
        const current = capturePageAnchor(host, elements, {
          x: rect.left,
          y: rect.top + 100,
        });
        if (current) setPage(current.index + 1);
      });
    };
    host.addEventListener('scroll', update, { passive: true });
    return () => {
      host.removeEventListener('scroll', update);
      cancelAnimationFrame(frame);
    };
  }, [scroll, pages]);
  const openFinder = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => { findInput.current?.focus(); findInput.current?.select(); });
  }, []);
  const closeFinder = () => {
    setFindOpen(false);
    setQuery('');
  };
  // Cmd/Ctrl+F finds in the preview while it, not the editor, has the focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'f') return;
      const host = scroll.current;
      const active = document.activeElement;
      if (!host || (active && !host.contains(active) && active !== document.body)) return;
      event.preventDefault();
      openFinder();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scroll, openFinder]);
  const step = (delta: number) => resize(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((zoom + delta) / 25) * 25)));
  return (
    <>
      {/* The pane itself scrolls, so the capsules ride on zero-height sticky rows. */}
      <div className={styles.overlayTop}>
        <div className={controls.tools} role="toolbar" aria-label={t('Typst reading controls')} data-active={findOpen || undefined}>
          {children}
          <button className={controls.btn} aria-pressed={findOpen} onClick={() => (findOpen ? closeFinder() : openFinder())}
            title={`${t('Find in document')} (${fmtShortcut('Ctrl+F')})`} aria-label={t('Find in preview')}>
            <IconSearch size={14} />
          </button>
        </div>
        {findOpen && (
          <div className={controls.finder}>
            <input
              ref={findInput}
              className={controls.finderInput}
              aria-label={t('Find in document')}
              placeholder={t('Find in document…')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setMatch(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  find(match + (e.shiftKey ? -1 : 1));
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  closeFinder();
                }
              }}
            />
            <span className={controls.finderInfo} aria-live="polite">
              {query ? `${hits.length ? Math.min(match + 1, hits.length) : 0}/${hits.length}` : ''}
            </span>
            <button className={controls.btn} disabled={!hits.length} onClick={() => find(match - 1)} aria-label={t('Previous match')} title={t('Previous (Shift+Enter)')}>↑</button>
            <button className={controls.btn} disabled={!hits.length} onClick={() => find(match + 1)} aria-label={t('Next match')} title={t('Next (Enter)')}>↓</button>
            <button className={controls.btn} onClick={closeFinder} aria-label={t('Close (Esc)')} title={t('Close (Esc)')}>×</button>
          </div>
        )}
      </div>
      <div className={styles.pages} style={{ width: `calc(min(100%, 960px) * ${zoom / 100})` }}>
        {pages.map((p, i) => (
          <ReaderPage
            key={i}
            page={p}
            index={i}
            scroll={scroll}
            stale={stale}
            highlights={highlights[i]}
            goto={goto}
            onNavigate={onNavigate}
          />
        ))}
      </div>
      <div className={styles.overlayBottom}>
        <div className={controls.pager} role="toolbar" aria-label={t('Pages and zoom')}>
          <button className={controls.btn} disabled={page <= 1} onClick={() => goto(page - 2)} aria-label={t('Previous page')} title={t('Previous page')}>
            <ToolIcon d="M10 4 6 8l4 4" />
          </button>
          <span className={controls.pageLabel}>
            <input
              className={controls.pageInput}
              aria-label={t('Page number')}
              disabled={!pages.length}
              value={pageDraft ?? (pages.length ? String(page) : '—')}
              onFocus={(event) => { setPageDraft(String(page)); event.currentTarget.select(); }}
              onChange={(event) => setPageDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const target = Number.parseInt(pageDraft ?? '', 10);
                  if (target) goto(target - 1);
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') event.currentTarget.blur();
              }}
              onBlur={() => setPageDraft(null)}
            />
            <span>{t('of {count}', { count: pages.length || '—' })}</span>
          </span>
          <button className={controls.btn} disabled={page >= pages.length} onClick={() => goto(page)} aria-label={t('Next page')} title={t('Next page')}>
            <ToolIcon d="m6 4 4 4-4 4" />
          </button>
          <span className={controls.divider} />
          <button className={controls.btn} disabled={zoom <= ZOOM_MIN} onClick={() => step(-25)} aria-label={t('Zoom out')} title={t('Zoom out')}>
            <ToolIcon d="M3.5 8h9" />
          </button>
          <button className={`${controls.btn} ${controls.info}`} aria-pressed={zoom === 100} onClick={() => resize(100)} title={t('Fit width')}>
            {Math.round(zoom)}%
          </button>
          <button className={controls.btn} disabled={zoom >= ZOOM_MAX} onClick={() => step(25)} aria-label={t('Zoom in')} title={t('Zoom in')}>
            <ToolIcon d="M3.5 8h9M8 3.5v9" />
          </button>
        </div>
      </div>
    </>
  );
}

