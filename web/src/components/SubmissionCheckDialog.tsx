import { t } from '../i18n';
import { useModal } from '../hooks/useModal';
import { useEffect, useState } from 'react';
import { dialogConfirm, dialogOpen, ipc, type BundleManifest, type SubmissionBuildVerification, type SubmissionReport } from '../api/tauri';
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
  const [manifest, setManifest] = useState<BundleManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [bundleResult, setBundleResult] = useState<string | null>(null);
  const [creatingBundle, setCreatingBundle] = useState(false);
  const [creatingArchive, setCreatingArchive] = useState(false);
  const [verifyingBundle, setVerifyingBundle] = useState(false);
  const busy = creatingBundle || creatingArchive || verifyingBundle;
  const modal = useModal(open, onClose, busy);
  const [verification, setVerification] = useState<SubmissionBuildVerification | null>(null);

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

  async function inspectManifest() {
    if (!root) return;
    setManifest(null); setManifestError(null); setBundleResult(null); setVerification(null);
    try { setManifest(await ipc.inspectSubmissionBundle(root)); }
    catch (reason) { setManifestError(String(reason)); }
  }

  async function createBundle() {
    if (!root || creatingBundle) return;
    const selected = await dialogOpen({ directory: true, multiple: false, title: 'Choose a folder outside the source workspace' });
    if (!selected || Array.isArray(selected)) return;
    setCreatingBundle(true); setManifestError(null); setBundleResult(null);
    try {
      const created = await ipc.createSubmissionBundle(root, selected);
      setBundleResult(`Created ${created.files} files (${(created.bytes / 1024).toFixed(1)} KB) at ${created.path}`);
    } catch (reason) { setManifestError(String(reason)); }
    finally { setCreatingBundle(false); }
  }

  async function createArchive() {
    if (!root || creatingArchive) return;
    const selected = await dialogOpen({ directory: true, multiple: false, title: 'Choose a folder outside the source workspace' });
    if (!selected || Array.isArray(selected)) return;
    setCreatingArchive(true); setManifestError(null); setBundleResult(null);
    try {
      const created = await ipc.createSubmissionArchive(root, selected);
      setBundleResult(`Created ZIP with ${created.files} files (${(created.bytes / 1024).toFixed(1)} KB) at ${created.path}`);
    } catch (reason) { setManifestError(String(reason)); }
    finally { setCreatingArchive(false); }
  }

  async function verifyBundle() {
    if (!root || verifyingBundle) return;
    const confirmed = await dialogConfirm('Run the configured LaTeX engine in an isolated temporary copy of the ready manifest? Shell escape is disabled. This does not modify the workspace, source bundle, or ZIP.', { title: 'Verify isolated submission build?' });
    if (!confirmed) return;
    setVerifyingBundle(true); setManifestError(null); setVerification(null);
    try { setVerification(await ipc.verifySubmissionBundle(root)); }
    catch (reason) { setManifestError(String(reason)); }
    finally { setVerifyingBundle(false); }
  }

  if (!open) return null;
  return <div className={styles.backdrop} onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
    <section {...modal} className={styles.dialog} role="dialog" aria-modal="true" aria-label={t("Submission Check")}>
      <header><div><h2>{t("Submission Check")}</h2><p>{t("Local preflight, source snapshot, ZIP export, and optional isolated build verification. Exports copy only the ready manifest outside your workspace; verification builds a temporary copy with shell escape disabled.")}</p></div><button type="button" disabled={busy} onClick={onClose}>{t("Close")}</button></header>
      <div className={styles.body}>
        {!root ? <p>{t("No workspace open.")}</p> : error ? <p className={styles.error}>{error}</p> : !report ? <p>{t("Checking submission readiness…")}</p> : <>
          <div className={`${styles.summary} ${report.ready ? styles.ready : styles.needs}`}>{report.ready ? t("No blocking errors found") : t("Submission needs attention")} · {report.scannedFiles} {t("files checked")}{report.truncated ? t(" · scan truncated") : ''}</div>
          {report.issues.length === 0 ? <p className={styles.empty}>{t("No static issues found.")}</p> : <ul>{report.issues.map((issue, index) => <li key={`${issue.code}:${issue.path}:${issue.line}:${index}`} className={styles[issue.severity]} onClick={() => issue.path && issue.line && onActivate(issue.path, issue.line)}>
            <span>{issue.code}</span><strong>{issue.message}</strong>{issue.path && <small>{issue.path.split(/[\\/]/).pop()}:{issue.line ?? 1}</small>}
          </li>)}</ul>}
        </>}
        {manifestError && <p className={styles.error}>{manifestError}</p>}
        {bundleResult && <p className={styles.created}>{bundleResult}</p>}
        {verification && <div className={verification.ok ? styles.created : styles.error}><strong>{verification.ok ? t("Isolated build verified") : t("Isolated build did not produce a PDF")}</strong> - {verification.engine}{verification.logTail && <details><summary>{t("Build log tail")}</summary><pre>{verification.logTail}</pre></details>}</div>}
        {manifest && <div className={styles.manifest}>
          <strong>{manifest.ready ? t("Bundle manifest ready") : t("Bundle manifest has warnings")}</strong>
          <span>{manifest.files.length} files ? {manifest.mainDocument.split(/[\/]/).pop()}</span>
          {manifest.warnings.length > 0 && <ul>{manifest.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          <details><summary>{t("Files that would be bundled")}</summary><ul>{manifest.files.map(file => <li key={file.relativePath}><code>{file.relativePath}</code> <small>{file.kind} ? {(file.sizeBytes / 1024).toFixed(1)} KB</small></li>)}</ul></details>
        </div>}
      </div>
      <footer>
        <button type="button" onClick={() => setRun(value => value + 1)}>{t("Run again")}</button>
        <button type="button" onClick={() => void inspectManifest()}>{t("Bundle manifest")}</button>
        <button type="button" disabled={!manifest?.ready || creatingBundle} onClick={() => void createBundle()} title={manifest?.ready ? t("Create a source-only snapshot outside this workspace") : t("Inspect a ready manifest before creating a bundle")}>{creatingBundle ? t("Creating...") : t("Create bundle...")}</button>
        <button type="button" disabled={!manifest?.ready || creatingArchive} onClick={() => void createArchive()} title={manifest?.ready ? t("Create a source-only ZIP outside this workspace") : t("Inspect a ready manifest before creating an archive")}>{creatingArchive ? t("Archiving...") : t("Create ZIP...")}</button>
        <button type="button" disabled={!manifest?.ready || verifyingBundle} onClick={() => void verifyBundle()} title={manifest?.ready ? t("Build a temporary manifest copy with shell escape disabled") : t("Inspect a ready manifest before verifying")}>{verifyingBundle ? t("Verifying...") : t("Verify build...")}</button>
      </footer>
    </section>
  </div>;
}
