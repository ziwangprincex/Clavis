import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTabsStore, useSettingsStore, useProjectStore } from '../store';
import { markdownWithMath } from '../render/markdown';
import { ipc, fs, hasTauri, dialogConfirm, type TypstResult } from '../api/tauri';
import { createLatestPreview } from '../compile/latestPreview';
import { documentRoot, typstInput, inside } from '../compile/project';
import { pathsEqual } from '../files/projectPaths';
import { useTypstPreviewStore } from '../store/typstPreview';
import 'katex/dist/katex.min.css';
import styles from './PreviewPane.module.css';
import { TypstReader } from './TypstReader';
import { previewDocuments, revisionCounter } from '../compile/previewRevision';
import { guidance } from '../compile/guidance';
import { previewTypography } from '../theme/typography';
import { useResolvedThemeSpec } from '../theme/appTheme';
import { accentTokens } from '../theme/chromeTokens';
import { contrast, mix } from '../theme/colors';
import { loadMarkdownImages, scrollToMarkdownHeading } from '../render/markdownView';
import type { CSSProperties } from 'react';

type Navigate = (path: string | null, line: number) => void;

export function PreviewPane({
  visible = true,
  onNavigate,
  onEnvironment,
  markdownJump,
}: {
  markdownJump?: { tabId: string; line: number; seq: number } | null;
  visible?: boolean;
  onNavigate?: Navigate;
  onEnvironment?: () => void;
}) {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeId);
  const project = useProjectStore();
  const settings = useSettingsStore((s) => s.settings);
  const lang = tab?.lang ?? 'markdown';
  const theme = useResolvedThemeSpec();
  let paperAccent = theme.accent;
  for (let amount = 0.05; contrast(paperAccent, '#ffffff') < 4.5 && amount <= 1; amount += 0.05) paperAccent = mix(theme.accent, '#000000', amount);
  const lightStyle = { ...accentTokens(paperAccent, false), '--selection': mix('#ffffff', paperAccent, 0.2) } as CSSProperties;
  const root = tab ? documentRoot(tab, project) : null;
  const documentKey = lang === 'typst' ? `typst:${root ?? tab?.id}` : `markdown:${tab?.id}`;
  const dependencies = useRef<{ key: string; paths: string[] }>();
  const counter = useRef(revisionCounter());
  const scope =
    tab && inside(tab.filePath, project.workspace?.root)
      ? project.workspace!.root
      : (root?.replace(/[\\/][^\\/]*$/, '') ?? null);
  const selected = lang === 'typst' ? previewDocuments(tabs, root, scope) : [];
  const relevant =
    lang === 'typst'
      ? previewDocuments(
          tabs,
          root,
          scope,
          dependencies.current?.key === documentKey ? dependencies.current.paths : undefined,
        )
      : [];
  const revision = counter.current([
    documentKey,
    tab?.filePath,
    tab?.filePath ? null : tab?.content,
    lang === 'markdown' ? tab?.content : null,
    ...relevant.flatMap((t) => [t.filePath, t.content]),
    scope,
  ]);
  const [retry, setRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<{
    key: string;
    revision: string;
    html: string;
    typst?: TypstResult;
    error: string;
  }>({ key: '', revision: '', html: '', error: '' });
  const [busy, setBusy] = useState(false);
  const resultRef = useRef(result);
  resultRef.current = result;
  const scroll = useRef<HTMLDivElement>(null);
  const jump = useTypstPreviewStore((s) => s.jump);
  const compiler = useMemo(
    () =>
      createLatestPreview(
        async (input: {
          tab: NonNullable<typeof tab>;
          tabs: typeof tabs;
          project: typeof project;
          key: string;
        }) => {
          const snapshot = await typstInput(input.tab, input.tabs, input.project);
          const previous = resultRef.current;
          return ipc.compileTypst(snapshot.source, snapshot.docPath, {
            ...snapshot.snapshot,
            knownSvg: previous.key === input.key ? (previous.typst?.pages.map((p) => p.svgHash) ?? []) : [],
          });
        },
      ),
    [],
  );

  useEffect(() => {
    if (!visible || lang === 'latex' || !tab) return;
    setBusy(true);
    const failure = (error: unknown) => {
      setResult((previous) => ({
        key: documentKey,
        revision,
        html: previous.key === documentKey ? previous.html : '',
        typst: previous.key === documentKey ? previous.typst : undefined,
        error: String(error),
      }));
      setBusy(false);
    };
    const timer = setTimeout(() => {
      if (lang === 'markdown') {
        try {
          setResult({ key: documentKey, revision, html: markdownWithMath(tab.content), error: '' });
          setBusy(false);
        } catch (error) {
          failure(error);
        }
      } else if (!hasTauri()) failure('Typst rendering requires the desktop app.');
      else
        compiler.request(
          { tab, tabs: selected, project, key: documentKey },
          (response) => {
            dependencies.current = response.ok
              ? { key: documentKey, paths: response.dependencies }
              : undefined;
            setResult((previous) => {
              const oldPages = previous.key === documentKey ? (previous.typst?.pages ?? []) : [];
              const pages = response.ok
                ? response.pages.map((page, i) => {
                    const old = oldPages[i];
                    return { ...page, svg: page.svg || (old?.svgHash === page.svgHash ? old.svg : '') };
                  })
                : oldPages;
              return { key: documentKey, revision, html: '', typst: { ...response, pages }, error: '' };
            });
            setBusy(false);
          },
          failure,
        );
    }, 200);
    return () => {
      clearTimeout(timer);
      compiler.cancel();
    };
    // `revision` captures content; do not recompile on cursor-only updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, revision, retry, compiler, project.workspace?.root, project.rootAbs]);

  const current = result.key === documentKey ? result : null;
  useEffect(() => {
    if (!visible || !current?.typst?.ok || !hasTauri()) return;
    const paths = current.typst.dependencies;
    let alive = true,
      checking = false;
    let previous: string | undefined;
    const probe = async () => {
      if (checking || !alive || paths.length === 0) return;
      checking = true;
      try {
        const stamps = [];
        for (let i = 0; i < paths.length; i += 200)
          stamps.push(...(await fs.probeDocuments(paths.slice(i, i + 200))));
        const next = JSON.stringify(stamps);
        if (alive && previous !== undefined && previous !== next) setRetry((n) => n + 1);
        previous = next;
      } catch (error) {
        if (alive) setResult((p) => ({ ...p, error: `Dependency check failed: ${String(error)}` }));
      } finally {
        checking = false;
      }
    };
    void probe();
    const timer = setInterval(() => void probe(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [visible, current?.typst]);
  const stale = busy || current?.revision !== revision || !!current?.error || current?.typst?.ok === false;
  useEffect(() => {
    if (!visible || stale || !jump || !current?.typst) return;
    let best: { index: number; y: number; distance: number } | undefined;
    current.typst.pages.forEach((page, index) =>
      page.points.forEach((point) => {
        if (!pathsEqual(point.file, jump.file)) return;
        const distance = Math.abs(point.line - jump.line);
        if (!best || distance < best.distance) best = { index, y: point.y / page.height, distance };
      }),
    );
    if (!best || !scroll.current) return;
    const page = scroll.current.querySelector<HTMLElement>(`[data-page="${best.index}"]`);
    if (page)
      scroll.current.scrollTo({
        top: page.offsetTop + best.y * page.clientHeight - scroll.current.clientHeight / 3,
      });
  }, [jump, visible, stale, current]);

  useEffect(() => {
    if (!visible || lang !== 'markdown' || !scroll.current || !current?.html) return;
    return loadMarkdownImages(scroll.current, tab?.filePath ?? null, scope, hasTauri());
  }, [visible, lang, current?.html, tab?.filePath, scope]);
  useEffect(() => {
    if (!visible || lang !== 'markdown' || !markdownJump || markdownJump.tabId !== tab?.id || stale || !scroll.current) return;
    scrollToMarkdownHeading(scroll.current, markdownJump.line);
  }, [visible, lang, markdownJump, tab?.id, stale, current?.html]);

  async function download(spec: string) {
    if (
      !(await dialogConfirm(
        `Download ${spec} from packages.typst.org?\n\nThe pinned version will be cached for offline use. Dependencies require separate confirmation.`,
        { title: 'Download Typst package?' },
      ))
    )
      return;
    setDownloading(true);
    try {
      await ipc.downloadTypstPackage(spec, true);
      setRetry((n) => n + 1);
    } catch (error) {
      setResult((p) => ({ ...p, error: String(error) }));
    } finally {
      setDownloading(false);
    }
  }
  return (
    <div
      ref={scroll}
      style={lang === 'markdown' && settings.preview_paper === 'light' ? lightStyle : undefined}
      onClick={event => {
        if (lang !== 'markdown') return;
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
        if (!link || !scroll.current) return;
        event.preventDefault();
        let id: string;
        try { id = decodeURIComponent(link.getAttribute('href')!.slice(1)); } catch { return; }
        const heading = Array.from(scroll.current.querySelectorAll<HTMLElement>('[id]')).find(element => element.id === id);
        heading?.scrollIntoView({ block: 'start', behavior: 'auto' });
      }}
      className={`${styles.root} ${lang === 'typst' ? styles.typeset : settings.preview_paper === 'light' ? styles.paperLight : ''}`}
    >
      {lang === 'typst' && (
        <div className={styles.previewStatus} role="status">
          <span>
            {stale
              ? busy
                ? t("Updating preview")
                : t("Preview not updated · showing last successful render")
              : t('{count} pages', { count: current?.typst?.pages.length ?? 0 })}
          </span>
          <button onClick={() => setRetry((n) => n + 1)} disabled={busy}> {t("Refresh")} </button>
        </div>
      )}
      {current?.error && (
        <div className={styles.error} role="alert">
          {current.error}
        </div>
      )}
      {!!current?.typst?.diagnostics.length && (
        <details className={styles.diagnostics}>
          <summary>{current.typst.diagnostics.length} {t("typesetting message(s)")}</summary>
          <button onClick={onEnvironment}>{t("Check environment…")}</button>
          {current.typst.diagnostics.map((d, i) => (
            <button
              key={i}
              className={styles.diagnostic}
              onClick={() => d.line && onNavigate?.(d.file, d.line)}
              disabled={!d.line || d.file?.startsWith('@') || current.revision !== revision}
            >
              <span>
                {d.severity} · {d.file?.split(/[\\/]/).pop() ?? 'Document'}
                {d.line ? `:${d.line}:${d.column ?? 1}` : ''}
              </span>
              <strong>{d.message}</strong>
              {d.hints.map((hint, j) => (
                <span key={j}>{hint}</span>
              ))}
              <span>{guidance('typst', d.message).explanation}</span>
            </button>
          ))}
          {current.typst.missingPackages
            .filter((spec) => spec.startsWith('@preview/'))
            .map((spec) => (
              <button key={spec} disabled={downloading} onClick={() => void download(spec)}> {t("Download")} {spec}…
              </button>
            ))}
        </details>
      )}
      {lang === 'typst' ? (
        <TypstReader
          key={documentKey}
          pages={current?.typst?.pages ?? []}
          scroll={scroll}
          stale={stale}
          onNavigate={onNavigate}
        />
      ) : (
        <div
          className={`${styles.preview} ${styles.markdown} ${settings.preview_reading_width === 'narrow' ? styles.widthNarrow : settings.preview_reading_width === 'medium' ? styles.widthMedium : ''}`}
          style={previewTypography(settings)}
          dangerouslySetInnerHTML={{ __html: current?.html ?? '' }}
        />
      )}
    </div>
  );
}
