import { t } from '../i18n';
import { useModal } from '../hooks/useModal';
﻿import { useMemo, useState } from 'react';
import { dialogConfirm, ipc, type WorkspaceSearchMatch } from '../api/tauri';
import { pathsEqual } from '../files/projectPaths';
import styles from './WorkspaceSearchDialog.module.css';

export interface WorkspaceSearchDialogProps {
  open: boolean;
  root: string | null;
  onClose: () => void;
  onOpenMatch: (path: string, line: number) => void;
  onFilesChanged: (paths: string[]) => void;
  dirtyPaths: string[];
}

export function WorkspaceSearchDialog({ open, root, onClose, onOpenMatch, onFilesChanged, dirtyPaths }: WorkspaceSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<WorkspaceSearchMatch[]>([]);
  const [summary, setSummary] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const modal = useModal(open, onClose, busy);
  const [error, setError] = useState<string | null>(null);

  const fingerprints = useMemo(() => Object.fromEntries(matches.map(m => [m.path, m.fingerprint])), [matches]);

  async function search() {
    if (!root || !query) return;
    setBusy(true); setError(null);
    try {
      const result = await ipc.searchWorkspace({ root, query, regex, caseSensitive });
      setMatches(result.matches);
      setTruncated(result.truncated);
      setSummary(`${result.matches.length} matches in ${result.scannedFiles} files${result.truncated ? t(" (truncated)") : ''}`);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function replaceAll() {
    if (!root || matches.length === 0) return;
    if (truncated) {
      setError('Refine the search before replacing: the result set is truncated.');
      return;
    }
    const dirtyMatch = dirtyPaths.find(path => matches.some(match => pathsEqual(path, match.path)));
    if (dirtyMatch) {
      setError(`Save or close the modified document before replacing on disk: ${dirtyMatch}`);
      return;
    }
    const confirmed = await dialogConfirm(
      `Replace ${matches.length} matched occurrence(s) across ${Object.keys(fingerprints).length} file(s)?\n\nFiles changed since this search will abort the entire operation.`,
      { title: 'Replace all matches?' },
    );
    if (!confirmed) return;
    setBusy(true); setError(null);
    try {
      const result = await ipc.replaceWorkspace({ root, query, replacement, regex, caseSensitive, fingerprints });
      onFilesChanged(result.changedFiles);
      setSummary(`Replaced ${result.replacements} occurrence(s) in ${result.changedFiles.length} file(s)`);
      setMatches([]);
      setTruncated(false);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  if (!open) return null;
  return (
    <div className={styles.backdrop} onMouseDown={e => e.target === e.currentTarget && !busy && onClose()}>
      <section {...modal} className={styles.dialog} role="dialog" aria-modal="true" aria-label={t("Workspace Search")}>
        <header className={styles.header}><div><h2>{t("Workspace Search")}</h2><p>{root ?? 'No workspace open'}</p></div><button disabled={busy} onClick={onClose}>{t("Close")}</button></header>
        <form className={styles.controls} onSubmit={e => { e.preventDefault(); void search(); }}>
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Search text or pattern")} />
          <input value={replacement} onChange={e => setReplacement(e.target.value)} placeholder={t("Replace with")} />
          <label><input type="checkbox" checked={regex} onChange={e => setRegex(e.target.checked)} /> {t("Regex")}</label>
          <label><input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} /> {t("Match case")}</label>
          <button type="submit" disabled={busy || !root || !query}>{busy ? t("Working…") : t("Search")}</button>
          <button type="button" disabled={busy || matches.length === 0 || truncated} onClick={() => void replaceAll()}>{t("Replace All")}</button>
        </form>
        <div className={styles.meta}>{error ? <span className={styles.error}>{error}</span> : summary}</div>
        <ul className={styles.results}>
          {matches.map((match, i) => (
            <li key={`${match.path}:${match.line}:${match.column}:${i}`} onClick={() => onOpenMatch(match.path, match.line)}>
              <div className={styles.location}>{match.relativePath}:{match.line}:{match.column}</div>
              <code>{match.preview}</code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
