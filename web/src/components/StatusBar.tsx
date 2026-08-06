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
import { useTabsStore, useCompileStore, useCursorStore, useStatusStore, useSettingsStore } from '../store';
import { computeResearchDetailStats, computeResearchStats, computeStats } from '../editor/stats';
import { documentLanguageLabel } from '../files/documentIdentity';
import styles from './StatusBar.module.css';


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
  const selectionFrom = useCursorStore(s => s.selectionFrom);
  const selectionTo = useCursorStore(s => s.selectionTo);
  const activeTab = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const compileStatus = useCompileStore(s => s.status);
  const errors = useCompileStore(s => s.errors);
  const writingLimits = useSettingsStore(s => ({ main: s.settings.writing_main_word_limit, abstract: s.settings.writing_abstract_word_limit }));

  const shownProblemCount = problemCount ?? errors.length;
  const isLatex = activeTab?.lang === 'latex';

  // Debounce the input to the word-count so long docs don't jank on typing.
  const contentForStats = useDebounced(activeTab?.content ?? '', WORD_COUNT_DEBOUNCE_MS);
  const stats = useMemo(() => computeStats(contentForStats), [contentForStats]);
  const research = useMemo(() => activeTab ? computeResearchStats(contentForStats, activeTab.lang) : null, [contentForStats, activeTab?.lang]);
  const detail = useMemo(() => activeTab ? computeResearchDetailStats(contentForStats, activeTab.lang, Math.min(selectionFrom, contentForStats.length), { from: selectionFrom, to: selectionTo }) : null, [contentForStats, activeTab?.lang, selectionFrom, selectionTo]);

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
      <span className={styles.cell}>{activeTab ? documentLanguageLabel(activeTab.filePath, activeTab.lang) : ''}</span>
      <span className={styles.cell} title="Words / characters">
        {stats.words.toLocaleString()} words · {stats.chars.toLocaleString()} chars
      </span>
      {research && (
        <span className={`${styles.cell} ${writingLimits.main > 0 && research.mainWords > writingLimits.main ? styles.limit : ''}`} title="Estimated prose words; markup, code and math are excluded">
          Main ? {research.mainWords.toLocaleString()}{writingLimits.main > 0 ? ` / ${writingLimits.main.toLocaleString()}` : ''}
        </span>
      )}
      {research?.abstractWords != null && (
        <span className={`${styles.cell} ${writingLimits.abstract > 0 && research.abstractWords > writingLimits.abstract ? styles.limit : ''}`} title="Estimated Abstract prose words">
          Abstract ? {research.abstractWords.toLocaleString()}{writingLimits.abstract > 0 ? ` / ${writingLimits.abstract.toLocaleString()}` : ''}
        </span>
      )}

      {detail?.selectionWords != null && <span className={styles.cell} title="Estimated prose words in the current selection">Selection ? {detail.selectionWords.toLocaleString()}</span>}
      {detail?.sectionWords != null && <span className={styles.cell} title="Estimated prose words in the current section">Section ? {detail.sectionWords.toLocaleString()}</span>}
      {detail && (detail.captionWords > 0 || detail.footnoteWords > 0) && <span className={styles.cell} title="Estimated caption and footnote prose words">Caps ? {detail.captionWords.toLocaleString()} ? Notes ? {detail.footnoteWords.toLocaleString()}</span>}

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
