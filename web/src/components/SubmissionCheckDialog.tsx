import { useEffect, useState } from 'react';
import { ipc, type SubmissionReport } from '../api/tauri';
import type { Tab } from '../store';
import styles from './SubmissionCheckDialog.module.css';

export interface SubmissionCheckDialogProps {
  open: boolean;
  root: string | null;
  tabs: readonly Tab[];
  onClose: () => void;
  onActivate: (path: string, line: number) => void;
}

export function SubmissionCheckDialog({ open, root, tabs, onClose, onActivate }: SubmissionCheckDialogProps) {
  const [report, setReport] = useState<SubmissionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!open || !root) return;
    let cancelled = false;
    setReport(null); setError(null);
    ipc.checkSubmission({ root, documents: tabs.filter(tab => tab.filePath).map(tab => ({ path: tab.filePath!, language: tab.lang, text: tab.content })) }).then(
      next => { if (!cancelled) setReport(next); },
      reason => { if (!cancelled) setError(String(reason)); },
    );
    return () => { cancelled = true; };
  }, [open, root, tabs, run]);

  if (!open) return null;
  return <div className={styles.backdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Submission Check">
      <header><div><h2>Submission Check</h2><p>Read-only preflight for visible local issues. It does not build, anonymize, or package your project.</p></div><button type="button" onClick={onClose}>Close</button></header>
      <div className={styles.body}>
        {!root ? <p>No workspace open.</p> : error ? <p className={styles.error}>{error}</p> : !report ? <p>Checking submission readiness…</p> : <>
          <div className={`${styles.summary} ${report.ready ? styles.ready : styles.needs}`}>{report.ready ? 'No blocking errors found' : 'Submission needs attention'} · {report.scannedFiles} files checked{report.truncated ? ' · scan truncated' : ''}</div>
          {report.issues.length === 0 ? <p className={styles.empty}>No static issues found.</p> : <ul>{report.issues.map((issue, index) => <li key={`${issue.code}:${issue.path}:${issue.line}:${index}`} className={styles[issue.severity]} onClick={() => issue.path && issue.line && onActivate(issue.path, issue.line)}>
            <span>{issue.code}</span><strong>{issue.message}</strong>{issue.path && <small>{issue.path.split(/[\\/]/).pop()}:{issue.line ?? 1}</small>}
          </li>)}</ul>}
        </>}
      </div>
      <footer><button type="button" onClick={() => setRun(value => value + 1)}>Run again</button></footer>
    </section>
  </div>;
}
