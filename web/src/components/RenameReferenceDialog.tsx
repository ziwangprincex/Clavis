import { useEffect, useState } from 'react';
import { dialogConfirm, ipc, type RenameReferencePreview } from '../api/tauri';
import type { Tab } from '../store';
import styles from './RenameReferenceDialog.module.css';

export interface RenameReferenceDialogProps {
  open: boolean;
  root: string | null;
  tabs: Tab[];
  initialNamespace?: 'label' | 'citation';
  initialKey?: string;
  onClose: () => void;
  onApplied: (paths: string[]) => void;
}

export function RenameReferenceDialog({ open, root, tabs, initialNamespace = 'label', initialKey = '', onClose, onApplied }: RenameReferenceDialogProps) {
  const [namespace, setNamespace] = useState<'label' | 'citation'>(initialNamespace);
  const [oldKey, setOldKey] = useState(initialKey);
  const [newKey, setNewKey] = useState('');
  const [preview, setPreview] = useState<RenameReferencePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNamespace(initialNamespace);
    setOldKey(initialKey);
    setNewKey('');
    setPreview(null);
    setError(null);
  }, [open, initialNamespace, initialKey]);

  const documents = tabs.filter(tab => tab.filePath).map(tab => ({
    path: tab.filePath!, language: tab.lang, text: tab.content, isDirty: tab.isDirty,
  }));

  async function loadPreview() {
    if (!root) return;
    setBusy(true); setError(null);
    try {
      setPreview(await ipc.previewReferenceRename({ root, documents, namespace, oldKey, newKey }));
    } catch (reason) { setPreview(null); setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!root || !preview) return;
    const confirmed = await dialogConfirm(
      `Rename ${preview.namespace} "${preview.oldKey}" to "${preview.newKey}" in ${preview.files.length} file(s), ${preview.totalOccurrences} occurrence(s)?`,
      { title: 'Apply reference rename?' },
    );
    if (!confirmed) return;
    setBusy(true); setError(null);
    try {
      const result = await ipc.applyReferenceRename({
        root,
        namespace: preview.namespace,
        oldKey: preview.oldKey,
        newKey: preview.newKey,
        fingerprints: Object.fromEntries(preview.files.map(file => [file.path, file.fingerprint])),
      });
      onApplied(result.changedFiles);
      onClose();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  if (!open) return null;
  return (
    <div className={styles.backdrop} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Rename reference">
        <header><div><h2>Rename Reference</h2><p>Exact indexed occurrences only; comments and code/raw blocks are excluded.</p></div><button onClick={onClose}>Close</button></header>
        <div className={styles.form}>
          <label>Kind<select value={namespace} onChange={e => { setNamespace(e.target.value as 'label' | 'citation'); setPreview(null); }}><option value="label">Label</option><option value="citation">Citation key</option></select></label>
          <label>Current key<input value={oldKey} onChange={e => { setOldKey(e.target.value); setPreview(null); }} /></label>
          <label>New key<input value={newKey} onChange={e => { setNewKey(e.target.value); setPreview(null); }} /></label>
          <button type="button" disabled={busy || !root || !oldKey || !newKey} onClick={() => void loadPreview()}>{busy ? 'Checking…' : 'Preview'}</button>
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.body}>
          {preview ? (
            <><div className={styles.summary}>{preview.totalOccurrences} occurrence(s) across {preview.files.length} file(s)</div><ul>{preview.files.map(file => <li key={file.path}><strong>{file.relativePath}</strong><span>{file.language} · {file.occurrences} occurrence(s) · first at line {file.firstLine}</span></li>)}</ul></>
          ) : <p className={styles.empty}>Preview validates collisions, dirty Documents, exact ranges, and file fingerprints before Apply is enabled.</p>}
        </div>
        <footer><button type="button" disabled={busy || !preview} onClick={() => void apply()}>Apply Rename</button></footer>
      </section>
    </div>
  );
}
