import { useMemo, useState } from 'react';
import { dialogConfirm } from '../api/tauri';
import { useGitStore } from '../store';
import { normalizeLatexForDiff, proseDiff } from '../git/proseDiff';
import styles from './GitSection.module.css';

export interface GitSectionProps { root: string; onRefresh: () => void; }

export function GitSection({ root, onRefresh }: GitSectionProps) {
  const status = useGitStore(s => s.status); const history = useGitStore(s => s.history); const diff = useGitStore(s => s.diff); const selected = useGitStore(s => s.selectedPath); const loading = useGitStore(s => s.loading); const error = useGitStore(s => s.error);
  const [message, setMessage] = useState(''); const [committing, setCommitting] = useState(false);
  const parts = useMemo(() => {
    const lines = diff.split('\n');
    const removed = lines.filter(line => line.startsWith('-') && !line.startsWith('---')).map(line => line.slice(1)).join('\n');
    const added = lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n');
    const latex = selected?.endsWith('.tex') ?? false;
    return proseDiff(latex ? normalizeLatexForDiff(removed) : removed, latex ? normalizeLatexForDiff(added) : added);
  }, [diff, selected]);

  async function createCommit() {
    const trimmed = message.trim();
    if (!trimmed || committing) return;
    const confirmed = await dialogConfirm(`Create a local commit with this message?\n\n${trimmed}\n\nThis does not push or contact any remote.`, { title: 'Create local commit?' });
    if (!confirmed) return;
    setCommitting(true);
    try { await useGitStore.getState().commit(root, trimmed); setMessage(''); }
    catch { /* Store surfaces error. */ }
    finally { setCommitting(false); }
  }

  return <div className={styles.root}>
    <div className={styles.head}><span>{status?.isRepository ? (status.branch ?? (status.detached ? 'detached' : 'repository')) : 'no repository'}</span><span>{status && `${status.ahead ? `?${status.ahead} ` : ''}${status.behind ? `?${status.behind}` : ''}`}</span><button type="button" disabled={loading} onClick={onRefresh}>?</button></div>
    {error && <div className={styles.error}>{error}</div>}
    {status?.isRepository && <ul className={styles.files}>{status.files.map(file => <li key={file.path} className={selected === file.path ? styles.active : ''} onClick={() => void useGitStore.getState().selectFile(root, file.path)}><span>{file.untracked ? '?' : `${file.indexStatus}${file.worktreeStatus}`}</span><span>{file.path}</span><button type="button" onClick={event => { event.stopPropagation(); void (file.untracked || file.worktreeStatus !== ' ' ? useGitStore.getState().stage(root, file.path) : useGitStore.getState().unstage(root, file.path)); }}>{file.untracked || file.worktreeStatus !== ' ' ? 'Stage' : 'Unstage'}</button></li>)}</ul>}
    {selected && <div className={styles.diff}><div className={styles.diffTitle}>{selected}</div><div className={styles.prose}>{parts.map((part, i) => <span key={i} className={styles[part.kind]}>{part.text}</span>)}</div><pre>{diff || '(no unstaged diff)'}</pre></div>}
    {status?.isRepository && <div className={styles.commit}><input value={message} maxLength={200} onChange={event => setMessage(event.target.value.replace(/[\r\n]/g, ''))} placeholder="Local commit message..." /><button type="button" disabled={committing || !message.trim()} onClick={() => void createCommit()}>{committing ? 'Committing...' : 'Commit staged'}</button><small>Local only - no push - hooks skipped</small></div>}
    {history.length > 0 && <div className={styles.history}>{history.slice(0, 5).map(commit => <div key={commit.id}><code>{commit.shortId}</code> {commit.subject}</div>)}</div>}
  </div>;
}
