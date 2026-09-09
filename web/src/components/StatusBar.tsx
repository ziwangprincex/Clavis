import { statusMessage } from '../i18n/status';
import { t } from '../i18n';
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
  const rawText = useStatusStore(s => s.text);
  const text = statusMessage(rawText);
  const settingsError = useSettingsStore(s => s.saveError);
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
  const saveText = !activeTab ? t("No document") : activeTab.isDirty ? t("Unsaved changes") : activeTab.filePath ? t("Saved") : t("Not saved to disk");
  const statusText = settingsError ? t('Settings were not saved: {error}', { error: settingsError }) : compiling ? t("Compiling…") : kind === 'error' ? text : saveText;
  const statusKind = settingsError || kind === 'error' ? 'error' : activeTab?.isDirty || !activeTab?.filePath ? 'info' : 'ok';

  return (
    <footer className={styles.bar}>
      <span className={`${styles.status} ${styles[statusKind]}`} role="status" aria-live="polite" title={statusText}>
        <span className={`${styles.dot} ${compiling ? styles.pulse : ''}`} />
        <span className={styles.statusText}>{statusText}</span>
      </span>
      {rawText !== 'Ready' && kind !== 'error' && !compiling && <span className={styles.message} title={text}>{text}</span>}
      <span className={styles.spacer} />
      <details className={styles.statsDisclosure} ref={disclosure} onToggle={event => setExpanded(event.currentTarget.open)} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false;
      }}>
        <summary ref={summary} className={styles.cell} title={t("Document statistics")}>{t('{count} words', { count: stats.words.toLocaleString() })}</summary>
        <div className={styles.statsPanel}>
          <strong>{t("Document statistics")}</strong>
          <dl>
            <dt>{t("Characters")}</dt><dd>{stats.chars.toLocaleString()}</dd>
            <dt>{t("Language")}</dt><dd>{activeTab ? documentLanguageLabel(activeTab.filePath, activeTab.lang) : t("None")}</dd>
            <dt>{t("Cursor")}</dt><dd>{t('Ln {line}, Col {column}', { line: cursor.line, column: cursor.column })}</dd>
            {research && <><dt>{t("Main text (estimated)")}</dt><dd className={mainLimit > 0 && research.mainWords > mainLimit ? styles.limit : ''}>{research.mainWords.toLocaleString()}{mainLimit > 0 ? ` / ${mainLimit.toLocaleString()}` : ''}</dd></>}
            {research?.abstractWords != null && <><dt>{t("Abstract (estimated)")}</dt><dd className={abstractLimit > 0 && research.abstractWords > abstractLimit ? styles.limit : ''}>{research.abstractWords.toLocaleString()}{abstractLimit > 0 ? ` / ${abstractLimit.toLocaleString()}` : ''}</dd></>}
            {detail?.selectionWords != null && <><dt>{t("Selection")}</dt><dd>{detail.selectionWords.toLocaleString()}</dd></>}
            {detail?.sectionWords != null && <><dt>{t("Current section")}</dt><dd>{detail.sectionWords.toLocaleString()}</dd></>}
            {detail && <><dt>{t("Captions")}</dt><dd>{detail.captionWords.toLocaleString()}</dd><dt>{t("Footnotes")}</dt><dd>{detail.footnoteWords.toLocaleString()}</dd></>}
          </dl>
        </div>
      </details>
      {isLatex && <button type="button" className={`${styles.cell} ${shownProblemCount > 0 ? styles.problems : ''}`} onClick={onToggleProblems} title={t("Toggle problems panel")}>
        {shownProblemCount === 0 ? t("No issues") : t('{count} issues', { count: shownProblemCount })}
      </button>}
    </footer>
  );
}
