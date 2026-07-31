// StatusBar — the app's bottom status strip.
//
// Left: the transient status message + severity dot (previously the Toolbar's
// status capsule). Right: cursor position (Ln/Col), language, word count, and
// (LaTeX only) an error-count chip that toggles the problems panel.
//
// Perf note on the word count: `tabsStore.content` updates on every keystroke
// (undebounced — see EditorPane.tsx). Scanning the full doc on every keystroke
// is fine for a README but becomes visible on a long .tex. The count is
// debounced via requestIdleCallback / setTimeout below; cursor line/col stays
// instant.

import { useEffect, useMemo, useState } from 'react';
import { useTabsStore, useCompileStore, useCursorStore, useStatusStore } from '../store';
import { computeStats } from '../editor/stats';
import styles from './StatusBar.module.css';

const LANG_LABEL: Record<string, string> = {
  markdown: 'Markdown',
  latex: 'LaTeX',
  typst: 'Typst',
};

const WORD_COUNT_DEBOUNCE_MS = 250;

/** Debounce a value change, using idle time when the browser supports it. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    });
    if (idle.requestIdleCallback) {
      const id = idle.requestIdleCallback(() => setV(value), { timeout: ms });
      return () => idle.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface StatusBarProps {
  problemCount?: number;
  onToggleProblems?: () => void;
}

export function StatusBar({ problemCount, onToggleProblems }: StatusBarProps) {
  const text = useStatusStore(s => s.text);
  const kind = useStatusStore(s => s.kind);
  const line = useCursorStore(s => s.line);
  const column = useCursorStore(s => s.column);
  const activeTab = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const compileStatus = useCompileStore(s => s.status);
  const errors = useCompileStore(s => s.errors);

  const shownProblemCount = problemCount ?? errors.length;
  const isLatex = activeTab?.lang === 'latex';

  // Debounce the input to the word-count so long docs don't jank on typing.
  const contentForStats = useDebounced(activeTab?.content ?? '', WORD_COUNT_DEBOUNCE_MS);
  const stats = useMemo(() => computeStats(contentForStats), [contentForStats]);

  const compiling = compileStatus === 'compiling';

  return (
    <footer className={styles.bar} role="status" aria-live="polite">
      <span className={`${styles.status} ${styles[kind]}`}>
        <span className={`${styles.dot} ${compiling ? styles.pulse : ''}`} />
        <span className={styles.statusText}>{text}</span>
      </span>

      <span className={styles.spacer} />

      <span className={styles.cell} title="Cursor position">
        Ln {line}, Col {column}
      </span>
      <span className={styles.cell}>{activeTab ? LANG_LABEL[activeTab.lang] : ''}</span>
      <span className={styles.cell} title="Words / characters">
        {stats.words.toLocaleString()} words · {stats.chars.toLocaleString()} chars
      </span>

      {isLatex && (
        <button
          type="button"
          className={`${styles.cell} ${shownProblemCount > 0 ? styles.problems : ''}`}
          onClick={onToggleProblems}
          title="Toggle problems panel"
        >
          {shownProblemCount === 0
            ? 'No issues'
            : `${shownProblemCount} ${shownProblemCount === 1 ? 'issue' : 'issues'}`}
        </button>
      )}
    </footer>
  );
}
