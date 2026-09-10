import { t } from '../i18n';
import { useCompileStore } from '../store';
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

export function LogPanel({ onJumpTo, onInstallPackage, onEnvironment, onSettings, onFullBuild }: LogPanelProps) {
  const { errors, logLines, logTail } = useCompileStore();

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>{t("Compile Log")}</span>
        <span className={styles.errCount}>
          {t('{count} issues', { count: errors.length })}
        </span>
      </div>

      <div className={styles.errors}>
        {errors.length === 0 ? (
          <div className={styles.muted}>{t("No errors.")}</div>
        ) : (
          errors.map((err, i) => {
            const guide = guidance('latex', err.message);
            const canAct = guide.action !== 'none' && (guide.action !== 'source' || !!err.line);
            return (
            <div key={i} className={`${styles.row} ${styles[`kind-${err.kind ?? 'error'}`] ?? ''}`}>
              {typeof err.line === 'number' && err.line > 0 ? (
                <a
                  className={styles.jump}
                  onClick={() => onJumpTo?.(err.file, err.line!)}
                  title={err.file ? `${err.file}:${err.line}` : t('Line {line}', { line: err.line })}
                >
                  L{err.line}
                </a>
              ) : (
                <span className={styles.muted}>--</span>
              )}
              <span className={styles.kindLabel}>{err.kind || 'error'}</span>
              <span className={styles.message}>{err.message}<small style={{ display: 'block', marginTop: 5, color: 'var(--text-muted)' }}>{t(guide.explanation)}</small>
                {canAct && <button className={styles.guide} onClick={() => {
                  if (guide.action === 'environment') onEnvironment?.();
                  else if (guide.action === 'engine') onSettings?.();
                  else if (guide.action === 'full-build') onFullBuild?.();
                  else if (err.line) onJumpTo?.(err.file, err.line);
                }}>{t(guide.label)}</button>}
              </span>
              {err.kind === 'missing-file' && err.package && (
                <button
                  className={styles.installBtn}
                  onClick={() => onInstallPackage?.(err.package!)}
                > {t("Install")} {err.package}
                </button>
              )}
            </div>
            );
          })
        )}
      </div>

      <details className={styles.rawDetails}>
        <summary>{t('Raw output ({count} lines)', { count: logLines.length })}</summary>
        <pre className={styles.raw}>
          {logLines.map((l, i) => (
            <span key={i} className={styles[`stream-${l.stream}`]}>
              [{l.run}] {l.text}
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
