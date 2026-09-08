import { useEffect, useMemo, useRef, useState } from 'react';
import { useTabsStore, useCompileStore, useCursorStore, useStatusStore, useSettingsStore } from '../store';
import { computeResearchDetailStats, computeResearchStats, computeStats } from '../editor/stats';
import { documentLanguageLabel } from '../files/documentIdentity';
import styles from './StatusBar.module.css';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(timer);
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
  const cursor = useCursorStore();
  const activeTab = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const compileStatus = useCompileStore(s => s.status);
  const errors = useCompileStore(s => s.errors);
  const mainLimit = useSettingsStore(s => s.settings.writing_main_word_limit);
  const abstractLimit = useSettingsStore(s => s.settings.writing_abstract_word_limit);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const content = useDebounced(activeTab?.content ?? '', 250);
  const stats = useMemo(() => computeStats(content), [content]);
  const research = useMemo(() => expanded && activeTab ? computeResearchStats(content, activeTab.lang) : null, [expanded, content, activeTab?.lang]);
  const detail = useMemo(() => expanded && activeTab ? computeResearchDetailStats(content, activeTab.lang, Math.min(cursor.selectionFrom, content.length), { from: cursor.selectionFrom, to: cursor.selectionTo }) : null, [expanded, content, activeTab?.lang, cursor.selectionFrom, cursor.selectionTo]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (disclosure.current && !disclosure.current.contains(event.target as Node)) disclosure.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && disclosure.current) {
        disclosure.current.open = false;
        summary.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [expanded]);

  const isLatex = activeTab?.lang === 'latex';
  const compiling = isLatex && compileStatus === 'compiling';
  const shownProblemCount = problemCount ?? errors.length;
  const saveText = !activeTab ? 'No document' : activeTab.isDirty ? 'Unsaved changes' : activeTab.filePath ? 'Saved' : 'Not saved to disk';
  const statusText = compiling ? 'Compiling…' : kind === 'error' ? text : saveText;
  const statusKind = kind === 'error' ? 'error' : activeTab?.isDirty || !activeTab?.filePath ? 'info' : 'ok';

  return (
    <footer className={styles.bar}>
      <span className={`${styles.status} ${styles[statusKind]}`} role="status" aria-live="polite" title={text}>
        <span className={`${styles.dot} ${compiling ? styles.pulse : ''}`} />
        <span className={styles.statusText}>{statusText}</span>
      </span>
      {text !== 'Ready' && kind !== 'error' && !compiling && <span className={styles.message} title={text}>{text}</span>}
      <span className={styles.spacer} />
      <details className={styles.statsDisclosure} ref={disclosure} onToggle={event => setExpanded(event.currentTarget.open)} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false;
      }}>
        <summary ref={summary} className={styles.cell} title="Document statistics">{stats.words.toLocaleString()} words</summary>
        <div className={styles.statsPanel}>
          <strong>Document statistics</strong>
          <dl>
            <dt>Characters</dt><dd>{stats.chars.toLocaleString()}</dd>
            <dt>Language</dt><dd>{activeTab ? documentLanguageLabel(activeTab.filePath, activeTab.lang) : 'None'}</dd>
            <dt>Cursor</dt><dd>Ln {cursor.line}, Col {cursor.column}</dd>
            {research && <><dt>Main text (estimated)</dt><dd className={mainLimit > 0 && research.mainWords > mainLimit ? styles.limit : ''}>{research.mainWords.toLocaleString()}{mainLimit > 0 ? ` / ${mainLimit.toLocaleString()}` : ''}</dd></>}
            {research?.abstractWords != null && <><dt>Abstract (estimated)</dt><dd className={abstractLimit > 0 && research.abstractWords > abstractLimit ? styles.limit : ''}>{research.abstractWords.toLocaleString()}{abstractLimit > 0 ? ` / ${abstractLimit.toLocaleString()}` : ''}</dd></>}
            {detail?.selectionWords != null && <><dt>Selection</dt><dd>{detail.selectionWords.toLocaleString()}</dd></>}
            {detail?.sectionWords != null && <><dt>Current section</dt><dd>{detail.sectionWords.toLocaleString()}</dd></>}
            {detail && <><dt>Captions</dt><dd>{detail.captionWords.toLocaleString()}</dd><dt>Footnotes</dt><dd>{detail.footnoteWords.toLocaleString()}</dd></>}
          </dl>
        </div>
      </details>
      {isLatex && <button type="button" className={`${styles.cell} ${shownProblemCount > 0 ? styles.problems : ''}`} onClick={onToggleProblems} title="Toggle problems panel">
        {shownProblemCount === 0 ? 'No issues' : `${shownProblemCount} ${shownProblemCount === 1 ? 'issue' : 'issues'}`}
      </button>}
    </footer>
  );
}
