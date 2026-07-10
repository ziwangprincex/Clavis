import { useCompileStore } from '../store';
import styles from './LogPanel.module.css';

export interface LogPanelProps {
  /** Jump to a diagnostic's location. `file` is the project-relative source file
   *  the engine reported (or undefined → the active/root file). */
  onJumpTo?: (file: string | undefined, line: number) => void;
  /** Called when user clicks "Install <pkg>" for a missing-file diag. */
  onInstallPackage?: (pkg: string) => void;
}

export function LogPanel({ onJumpTo, onInstallPackage }: LogPanelProps) {
  const { errors, logLines, logTail } = useCompileStore();

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>Compile Log</span>
        <span className={styles.errCount}>
          {errors.length} {errors.length === 1 ? 'issue' : 'issues'}
        </span>
      </div>

      <div className={styles.errors}>
        {errors.length === 0 ? (
          <div className={styles.muted}>No errors.</div>
        ) : (
          errors.map((err, i) => (
            <div key={i} className={`${styles.row} ${styles[`kind-${err.kind ?? 'error'}`] ?? ''}`}>
              {typeof err.line === 'number' && err.line > 0 ? (
                <a
                  className={styles.jump}
                  onClick={() => onJumpTo?.(err.file, err.line!)}
                  title={err.file ? `${err.file}:${err.line}` : `Line ${err.line}`}
                >
                  L{err.line}
                </a>
              ) : (
                <span className={styles.muted}>--</span>
              )}
              <span className={styles.kindLabel}>{err.kind || 'error'}</span>
              <span className={styles.message}>{err.message}</span>
              {err.kind === 'missing-file' && err.package && (
                <button
                  className={styles.installBtn}
                  onClick={() => onInstallPackage?.(err.package!)}
                >
                  Install {err.package}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <details className={styles.rawDetails}>
        <summary>Raw output ({logLines.length} lines)</summary>
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
