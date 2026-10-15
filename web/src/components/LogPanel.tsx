import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { useCompileStore } from '../store';
import type { LogLine } from '../store/compile';
import styles from './LogPanel.module.css';
import { guidance } from '../compile/guidance';

export interface LogPanelProps {
  onEnvironment?: () => void;
  onSettings?: () => void;
  onFullBuild?: () => void;
  /** Jump to a diagnostic's location. `file` is the project-relative source file
   *  the engine reported (or undefined → the active/root file). */
  onJumpTo?: (file: string | undefined, line: number) => void;
  /** Called when user clicks "Install <pkg>" for a missing-file diag. */
  onInstallPackage?: (pkg: string) => void;
}

/** The raw-output line a diagnostic came from: the last line containing its
 *  first line of text, since problems are read from the final pass. */
export function logLineFor(lines: readonly LogLine[], message: string): number {
  const needle = message.split('\n')[0].replace(/^!\s*/, '').trim().slice(0, 80);
  if (!needle) return -1;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].text.includes(needle)) return i;
  return -1;
}

export function LogPanel({ onJumpTo, onInstallPackage, onEnvironment, onSettings, onFullBuild }: LogPanelProps) {
  const { status, errors, logLines, logTail } = useCompileStore();
  // Texifier selects an issue's place in the raw log; here the line is opened and marked.
  const [rawOpen, setRawOpen] = useState(false);
  const [marked, setMarked] = useState(-1);
  const raw = useRef<HTMLPreElement>(null);
  useEffect(() => setMarked(-1), [logLines]);
  useEffect(() => {
    if (marked >= 0) raw.current?.querySelector(`[data-line="${marked}"]`)?.scrollIntoView({ block: 'center' });
  }, [marked]);
  const emptyMessage = status === 'compiling' ? 'Compiling…'
    : status === 'error' ? 'Compilation failed. Details are in the raw output.'
    : status === 'ok' ? 'No errors.' : 'No compile result yet.';

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>{t("Compile Log")}</span>
        {(errors.length > 0 || status === 'ok') && <span className={styles.errCount}>
          {t('{count} issues', { count: errors.length })}
        </span>}
      </div>

      <div className={styles.errors}>
        {errors.length === 0 ? (
          <div className={styles.muted}>{t(emptyMessage)}</div>
        ) : (
          errors.map((err, i) => {
            const guide = guidance('latex', err.message);
            const hasLine = typeof err.line === 'number' && Number.isInteger(err.line) && err.line > 0;
            const canAct = guide.action !== 'none' && (guide.action !== 'source' || (hasLine && !!onJumpTo));
            const inLog = logLineFor(logLines, err.message);
            return (
            <div key={i} className={`${styles.row} ${styles[`kind-${err.kind ?? 'error'}`] ?? ''}`}>
              <div className={styles.rowHead}>
                <span className={styles.kindLabel}>{err.kind || 'error'}</span>
                {hasLine && onJumpTo && (
                  <button
                    type="button"
                    className={styles.jump}
                    onClick={() => onJumpTo?.(err.file, err.line!)}
                    title={err.file ? `${err.file}:${err.line}` : t('Line {line}', { line: err.line! })}
                  >
                    <bdi dir="ltr">{err.file ? `${err.file}:${err.line}` : `L${err.line}`}</bdi>
                  </button>
                )}
                {inLog >= 0 && <button type="button" className={styles.jump} title={t('Show this problem in the raw output')}
                  onClick={() => { setRawOpen(true); setMarked(inLog); }}>{t('In log')}</button>}
              </div>
              <div className={styles.message}>{err.message}</div>
              <small className={styles.explanation}>{t(guide.explanation)}</small>
              {(canAct || (err.kind === 'missing-file' && err.package)) && (
                <div className={styles.actions}>
                  {canAct && <button className={styles.guide} onClick={() => {
                    if (guide.action === 'environment') onEnvironment?.();
                    else if (guide.action === 'engine') onSettings?.();
                    else if (guide.action === 'full-build') onFullBuild?.();
                    else if (err.line) onJumpTo?.(err.file, err.line);
                  }}>{t(guide.label)}</button>}
                  {err.kind === 'missing-file' && err.package && (
                    <button
                      className={styles.installBtn}
                      onClick={() => onInstallPackage?.(err.package!)}
                    > {t("Install")} {err.package}
                    </button>
                  )}
                </div>
              )}
            </div>
            );
          })
        )}
      </div>

      <details className={styles.rawDetails} open={rawOpen} onToggle={event => setRawOpen(event.currentTarget.open)}>
        <summary>{t('Raw output ({count} lines)', { count: logLines.length })}</summary>
        <pre className={styles.raw} ref={raw}>
          {logLines.map((l, i) => (
            <span key={i} data-line={i} className={`${styles[`stream-${l.stream}`] ?? ''} ${i === marked ? styles.marked : ''}`}>
              [{l.run}] {l.text}{l.text.endsWith('\n') ? '' : '\n'}
            </span>
          ))}
          {logTail && (
            <>
              {'\n--- summary log tail ---\n'}
              {logTail}
            </>
          )}
        </pre>
      </details>
    </div>
  );
}
