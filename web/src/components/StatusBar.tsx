import { statusMessage } from '../i18n/status';
import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTabsStore, useCompileStore, useCursorStore, useStatusStore, useSettingsStore } from '../store';
import { describeChain } from '../store/compile';
import { computeResearchDetailStats, computeResearchStats, computeStats, countWords, readingMinutes } from '../editor/stats';
import { documentLanguageLabel } from '../files/documentIdentity';
import { useDebounced } from '../hooks/useDebounced';
import styles from './StatusBar.module.css';

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
  const chain = useCompileStore(s => s.chain);
  const errors = useCompileStore(s => s.errors);
  const mainLimit = useSettingsStore(s => s.settings.writing_main_word_limit);
  const abstractLimit = useSettingsStore(s => s.settings.writing_abstract_word_limit);
  const readingSpeed = useSettingsStore(s => s.settings.reading_speed ?? 300);
  const disclosure = useRef<HTMLDetailsElement>(null);
  // A message stays a few seconds; an error stays until something replaces it.
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    setFresh(rawText !== 'Ready');
    if (rawText === 'Ready' || kind === 'error') return;
    const timer = setTimeout(() => setFresh(false), 4000);
    return () => clearTimeout(timer);
  }, [rawText, kind]);
  const summary = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const content = useDebounced(activeTab?.content ?? '', 250, activeTab?.id);
  const stats = useMemo(() => computeStats(content), [content]);
  // A selection shows its own count first, as Typora's word count does.
  const selected = useMemo(() => cursor.selectionTo > cursor.selectionFrom
    ? countWords(content.slice(cursor.selectionFrom, cursor.selectionTo)) : null, [content, cursor.selectionFrom, cursor.selectionTo]);
  const lang = activeTab?.lang;
  const research = useMemo(() => expanded && lang ? computeResearchStats(content, lang) : null, [expanded, content, lang]);
  const detail = useMemo(() => expanded && lang ? computeResearchDetailStats(content, lang, Math.min(cursor.selectionFrom, content.length), { from: cursor.selectionFrom, to: cursor.selectionTo }) : null, [expanded, content, lang, cursor.selectionFrom, cursor.selectionTo]);
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
  const problemsLabel = shownProblemCount > 0 ? t('{count} issues', { count: shownProblemCount })
    : compiling ? t('Compiling…') : compileStatus === 'error' ? t('Compile failed')
    : compileStatus === 'ok' ? t('No issues') : t('Compile Log');
  const statusText = settingsError ? t('Settings were not saved: {error}', { error: settingsError }) : text;

  // Shown only when it says something: a build running, a fresh message, an
  // error. The unsaved state is the dot beside the document name.
  // A running build shows on the problems button, which opens its live log.
  const notice = !!settingsError || (fresh && !compiling);
  const noticeKind = settingsError || kind === 'error' ? 'error' : kind;
  const problemsShown = isLatex && (compileStatus !== 'idle' || shownProblemCount > 0);
  return (
    <div className={styles.bar}>
      <span className={`${styles.status} ${styles[noticeKind]}`} role="status" aria-live="polite" title={statusText} hidden={!notice}>
        <span className={styles.dot} />
        <span className={styles.statusText}>{statusText}</span>
      </span>
      <details className={styles.statsDisclosure} ref={disclosure} onToggle={event => setExpanded(event.currentTarget.open)} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false;
      }}>
        <summary ref={summary} className={styles.cell} title={t("Document statistics")}>{selected === null
          ? t('{count} words', { count: stats.words.toLocaleString() })
          : t('{selected} of {count} words', { selected: selected.toLocaleString(), count: stats.words.toLocaleString() })}</summary>
        <div className={styles.statsPanel}>
          <strong>{t("Document statistics")}</strong>
          <dl>
            <dt>{t("Characters")}</dt><dd>{stats.chars.toLocaleString()}</dd>
            <dt>{t("Reading time")}</dt><dd>{t('About {count} min', { count: readingMinutes(research?.mainWords ?? stats.words, readingSpeed) })}</dd>
            <dt>{t("Language")}</dt><dd>{activeTab ? documentLanguageLabel(activeTab.filePath, activeTab.lang) : t("None")}</dd>
            <dt>{t("Cursor")}</dt><dd>{t('Ln {line}, Col {column}', { line: cursor.line, column: cursor.column })}</dd>
            {research && <><dt>{t("Main text (estimated)")}</dt><dd className={mainLimit > 0 && research.mainWords > mainLimit ? styles.limit : ''}>{research.mainWords.toLocaleString()}{mainLimit > 0 ? ` / ${mainLimit.toLocaleString()}` : ''}</dd></>}
            {research?.abstractWords != null && <><dt>{t("Abstract (estimated)")}</dt><dd className={abstractLimit > 0 && research.abstractWords > abstractLimit ? styles.limit : ''}>{research.abstractWords.toLocaleString()}{abstractLimit > 0 ? ` / ${abstractLimit.toLocaleString()}` : ''}</dd></>}
            {detail?.selectionWords != null && <><dt>{t("Selection")}</dt><dd>{detail.selectionWords.toLocaleString()}</dd></>}
            {detail?.sectionWords != null && <><dt>{t("Current section")}</dt><dd>{detail.sectionWords.toLocaleString()}</dd></>}
            {detail && <><dt>{t("Captions")}</dt><dd>{detail.captionWords.toLocaleString()}</dd><dt>{t("Footnotes")}</dt><dd>{detail.footnoteWords.toLocaleString()}</dd></>}
            {isLatex && chain && <><dt>{t('Programs that ran in the last build')}</dt><dd>{describeChain(chain, count => t(count === 1 ? '{count} pass' : '{count} passes', { count }))}</dd></>}
          </dl>
        </div>
      </details>
      {problemsShown && <button type="button" className={`${styles.cell} ${styles.build} ${shownProblemCount > 0 || compileStatus === 'error' ? styles.problems : ''}`} onClick={onToggleProblems} title={t("Toggle problems panel")}>
        {compiling && <span className={`${styles.dot} ${styles.pulse}`} aria-hidden="true" />}
        {problemsLabel}
      </button>}
    </div>
  );
}
