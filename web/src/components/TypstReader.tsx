import { t } from '../i18n';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { TypstPage } from '../api/tauri';
import styles from './TypstReader.module.css';
import { findReadingMatches, type ReadingMatch } from '../compile/readingText';
import { bindPreviewZoom, capturePageAnchor, restorePageAnchor, type ZoomPoint } from '../pdf/zoom';

type Navigate = (path: string | null, line: number) => void;
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
}: {
  pages: TypstPage[];
  scroll: RefObject<HTMLDivElement>;
  stale: boolean;
  onNavigate?: Navigate;
}) {
  const [zoom, setZoom] = useState(100),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(''),
    [match, setMatch] = useState(0);
  const hits = useMemo(() => findReadingMatches(pages, query), [pages, query]);
  const highlights = useMemo(() => {
    const byPage: number[][] = pages.map(() => []);
    for (const hit of hits) byPage[hit.page].push(...hit.runs);
    return byPage;
  }, [pages, hits]);
  const [pageInput, setPageInput] = useState('1');
  const goto = useCallback(
    (index: number, y = 0) => {
      const bounded = Math.max(0, Math.min(pages.length - 1, index));
      const element = scroll.current?.querySelector<HTMLElement>(`[data-page="${bounded}"]`);
      if (element && scroll.current) {
        scroll.current.scrollTop =
          element.offsetTop + (y / pages[bounded].height) * element.clientHeight - 76;
        setPage(bounded + 1);
        setPageInput(String(bounded + 1));
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
  const pageElements = () =>
    Array.from(scroll.current?.querySelectorAll<HTMLElement>('[data-page]') ?? []);
  const resize = useCallback(
    (value: number, point?: ZoomPoint) => {
      if (value === zoomRef.current || !scroll.current) return;
      anchor.current = capturePageAnchor(
        scroll.current,
        Array.from(scroll.current.querySelectorAll<HTMLElement>('[data-page]')),
        point,
      );
      zoomRef.current = value;
      setZoom(value);
    },
    [scroll],
  );
  useLayoutEffect(() => {
    if (scroll.current) restorePageAnchor(scroll.current, pageElements(), anchor.current);
    anchor.current = null;
  }, [zoom]);
  useEffect(() => {
    const host = scroll.current;
    if (!host) return;
    return bindPreviewZoom(host, () => zoomRef.current, resize, 50, 400);
  }, [scroll, resize]);
  useEffect(() => {
    const host = scroll.current;
    if (!host) return;
    let frame = 0;
    const elements = pageElements();
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = host.getBoundingClientRect();
        const current = capturePageAnchor(host, elements, {
          x: rect.left,
          y: rect.top + 100,
        });
        if (current) {
          setPage(current.index + 1);
          setPageInput(String(current.index + 1));
        }
      });
    };
    host.addEventListener('scroll', update, { passive: true });
    return () => {
      host.removeEventListener('scroll', update);
      cancelAnimationFrame(frame);
    };
  }, [scroll, pages]);
  return (
    <>
      <div className={styles.toolbar} aria-label={t("Typst reading controls")}>
        <button disabled={page <= 1} onClick={() => goto(page - 2)} aria-label={t("Previous page")}>
          ‹
        </button>
        <input
          aria-label={t("Page number")}
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') goto((Number(pageInput) || 1) - 1);
          }}
          onBlur={() => goto((Number(pageInput) || 1) - 1)}
          className={styles.pageInput}
        />
        <span>/ {pages.length}</span>
        <button disabled={page >= pages.length} onClick={() => goto(page)} aria-label={t("Next page")}>
          ›
        </button>
        <select aria-label={t("Zoom")} value={zoom} onChange={(e) => resize(Number(e.target.value))}>
          {![75, 100, 125, 150, 200].includes(zoom) && (
            <option value={zoom}>{Math.round(zoom)}%</option>
          )}
          {[75, 100, 125, 150, 200].map((n) => (
            <option key={n} value={n}>
              {n === 100 ? t("Fit width") : `${n}%`}
            </option>
          ))}
        </select>
        <input
          aria-label={t("Find in document")}
          placeholder={t("Find in document…")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMatch(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              find(match + (e.shiftKey ? -1 : 1));
            }
            if (e.key === 'Escape') setQuery('');
          }}
        />
        <span aria-live="polite">
          {query ? `${hits.length ? Math.min(match + 1, hits.length) : 0}/${hits.length}` : ''}
        </span>
        <button disabled={!hits.length} onClick={() => find(match - 1)} aria-label={t("Previous match")}>
          ↑
        </button>
        <button disabled={!hits.length} onClick={() => find(match + 1)} aria-label={t("Next match")}>
          ↓
        </button>
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
    </>
  );
}
