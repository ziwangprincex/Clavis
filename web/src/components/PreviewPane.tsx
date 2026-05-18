// PreviewPane — live preview for Markdown and Typst.
// LaTeX preview is handled by the PDF viewer (fourth migration wave).

import { useEffect, useMemo, useState } from 'react';
import { useTabsStore, useSettingsStore } from '../store';
import { markdownWithMath } from '../render/markdown';
import { ipc, hasTauri } from '../api/tauri';
import 'katex/dist/katex.min.css';
import styles from './PreviewPane.module.css';

const RENDER_DEBOUNCE_MS = 200;

// Bounded LRU cache for Typst render results (source -> SVG html).
// Typst compile is fast but not free; caching the last few unique sources
// makes Ctrl+Z / tab switching feel instant. Bound at 8 entries (~few MB at
// most, evicted FIFO) so a long editing session can't leak memory.
const TYPST_CACHE_LIMIT = 8;
const typstCache = new Map<string, string>();
function typstCacheGet(src: string): string | undefined {
  const v = typstCache.get(src);
  if (v !== undefined) {
    // Re-insert to mark as most recently used (Map preserves insertion order).
    typstCache.delete(src);
    typstCache.set(src, v);
  }
  return v;
}
function typstCacheSet(src: string, html: string) {
  if (typstCache.has(src)) typstCache.delete(src);
  typstCache.set(src, html);
  while (typstCache.size > TYPST_CACHE_LIMIT) {
    const oldest = typstCache.keys().next().value;
    if (oldest === undefined) break;
    typstCache.delete(oldest);
  }
}

export function PreviewPane() {
  const activeTab = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const content = activeTab?.content ?? '';
  const lang = activeTab?.lang ?? 'markdown';

  const previewFontFamily = useSettingsStore(s => s.settings.preview_font_family);
  const previewFontSize = useSettingsStore(s => s.settings.preview_font_size);

  const previewStyle: React.CSSProperties = {
    fontFamily: previewFontFamily || undefined,
    fontSize: previewFontSize ? `${previewFontSize}px` : undefined,
  };

  const [debounced, setDebounced] = useState({ content, lang });

  useEffect(() => {
    const t = setTimeout(() => setDebounced({ content, lang }), RENDER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [content, lang]);

  const [typstHtml, setTypstHtml] = useState<string>('');
  const [typstError, setTypstError] = useState<string | null>(null);

  // Markdown is synchronous.
  const markdownHtml = useMemo(() => {
    if (debounced.lang !== 'markdown') return '';
    try {
      return markdownWithMath(debounced.content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `<div class="${styles.error}">Render error: ${msg}</div>`;
    }
  }, [debounced]);

  // Typst goes through Tauri IPC (Rust does the heavy lifting).
  useEffect(() => {
    if (debounced.lang !== 'typst') return;
    if (!hasTauri()) {
      setTypstHtml('');
      setTypstError('Typst rendering requires the Tauri runtime.');
      return;
    }
    const cached = typstCacheGet(debounced.content);
    if (cached) {
      setTypstHtml(cached);
      setTypstError(null);
      return;
    }
    let cancelled = false;
    ipc
      .compileTypst(debounced.content)
      .then(r => {
        if (cancelled) return;
        if (r.ok && r.svg) {
          const html = `<div class="${styles.typstSvg}">${r.svg}</div>`;
          typstCacheSet(debounced.content, html);
          setTypstHtml(html);
          setTypstError(null);
        } else {
          setTypstHtml('');
          setTypstError(r.error ?? 'Typst compilation failed');
        }
      })
      .catch(e => {
        if (cancelled) return;
        setTypstHtml('');
        setTypstError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  if (debounced.lang === 'latex') {
    return (
      <div className={styles.root}>
        <div className={styles.notice}>
          LaTeX preview is shown in the PDF viewer (compile to render).
        </div>
      </div>
    );
  }

  if (debounced.lang === 'typst') {
    return (
      <div className={styles.root}>
        {typstError ? (
          <div className={styles.error}>{typstError}</div>
        ) : (
          <div
            className={styles.preview}
            style={previewStyle}
            // SVG comes from typst-svg in the Rust backend (trusted source).
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: typstHtml }}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div
        className={`${styles.preview} ${styles.markdown}`}
        style={previewStyle}
        // marked + KaTeX output. Source comes from the user's editor.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: markdownHtml }}
      />
    </div>
  );
}
