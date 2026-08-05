import { useEffect, useState } from 'react';
import { ipc, type ProjectDoctorReport, type WorkspaceInspection } from '../api/tauri';
import styles from './ProjectDoctorDialog.module.css';

export interface ProjectDoctorDialogProps {
  open: boolean;
  workspace: WorkspaceInspection | null;
  onClose: () => void;
}

export function ProjectDoctorDialog({ open, workspace, onClose }: ProjectDoctorDialogProps) {
  const [report, setReport] = useState<ProjectDoctorReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!open || !workspace) return;
    let cancelled = false;
    setReport(null);
    setError(null);
    ipc.doctorWorkspace(workspace.root).then(
      next => { if (!cancelled) setReport(next); },
      reason => { if (!cancelled) setError(String(reason)); },
    );
    return () => { cancelled = true; };
  }, [open, workspace, refresh]);

  if (!open) return null;
  return (
    <div className={styles.backdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Project Doctor">
        <header className={styles.header}>
          <div>
            <h2>Project Doctor</h2>
            <p>{workspace?.root ?? 'No workspace open'}</p>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className={styles.body}>
          {!workspace ? (
            <p className={styles.empty}>Open a workspace first.</p>
          ) : error ? (
            <p className={styles.error}>{error}</p>
          ) : !report ? (
            <p className={styles.empty}>Inspecting project…</p>
          ) : (
            <>
              <div className={`${styles.summary} ${report.ok ? styles.good : styles.bad}`}>
                {report.ok ? 'Project is ready' : 'Project needs attention'}
              </div>
              <ul className={styles.checks}>
                {report.checks.map((check, index) => (
                  <li key={`${check.id}-${index}`} className={styles[check.status]}>
                    <span className={styles.icon} aria-hidden="true">
                      {check.status === 'ok' ? '✓' : check.status === 'warning' ? '!' : '×'}
                    </span>
                    <span>{check.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {workspace && (
          <footer className={styles.footer}>
            <button type="button" onClick={() => setRefresh(value => value + 1)}>Run again</button>
          </footer>
        )}
      </section>
    </div>
  );
}
