import { useEffect, useRef, useState } from 'react';
import { fs, type DiskSnapshot } from '../api/tauri';
import { useTabsStore } from '../store/tabs';
import { saveTabToDisk } from '../files/save';
import { checkExternalDocuments, documentOperation, markConflict, retainLocalCopy } from '../files/documentSync';
import { proseDiff } from '../git/proseDiff';
import styles from './SaveConflictNotice.module.css';

interface Review { id: string; targetPath: string; disk: DiskSnapshot; buffer: string }

function ConflictReview({ review, onClose }: { review: Review; onClose: () => void }) {
  const [merged, setMerged] = useState(review.buffer);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const modal = useRef<HTMLElement>(null);
  const tab = useTabsStore(s => s.tabs.find(t => t.id === review.id));
  const changed = !tab || tab.content !== review.buffer || tab.conflict?.disk.revision !== review.disk.revision;
  const fullSize = Math.max(review.buffer.length, review.disk.content?.length ?? 0);
  const diffLimit = 12_000;
  function closeReview() {
    if (merged !== review.buffer) retainLocalCopy({ title: tab?.title ?? 'Recovered merge', lang: tab?.lang ?? 'markdown', content: merged }, 'merge draft');
    onClose();
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modal.current?.focus();
    return () => { previous?.focus?.(); };
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  async function save(merge: boolean) {
    const path = await saveTabToDisk(review.id, { resolution: {
      targetPath: review.targetPath, revision: review.disk.revision,
      buffer: review.buffer, ...(merge ? { merged } : {}),
    } });
    if (path) closeReview();
    else setError('The disk changed again. Close this comparison and review the newest version. Your draft above is still available to copy.');
  }
  async function useDisk() {
    await documentOperation(async () => {
      const current = useTabsStore.getState().tabs.find(t => t.id === review.id);
      if (!current || current.content !== review.buffer || current.filePath !== review.targetPath) throw new Error('Document changed; review it again.');
      const disk = await fs.readDocument(review.targetPath);
      const latest = useTabsStore.getState().tabs.find(t => t.id === review.id);
      if (!latest || latest.content !== review.buffer || latest.filePath !== current.filePath) throw new Error('Local document changed; review it again.');
      if (disk.revision !== review.disk.revision || disk.content === null) {
        markConflict(review.id, review.targetPath, disk);
        throw new Error('Disk changed again; close this comparison and review the new version.');
      }
      retainLocalCopy(latest);
      useTabsStore.getState().patchTab(review.id, { content: disk.content, isDirty: false,
        diskRevision: disk.revision, diskStamp: disk.stamp, conflict: undefined, diskError: undefined });
      closeReview();
    });
  }
  return <div className={styles.backdrop}>
    <section ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="save-conflict-title"
      className={styles.dialog} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape' && !busy) { event.preventDefault(); closeReview(); }
        if (event.key === 'Tab') {
          const controls = [...(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), summary') ?? [])];
          const first = controls[0]; const last = controls.at(-1);
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === modal.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modal.current)) { event.preventDefault(); first.focus(); }
        }
      }}>
      <header><div><h2 id="save-conflict-title">Keep your writing safe</h2><p>{review.targetPath}</p></div><button disabled={busy} onClick={closeReview}>Later</button></header>
      <p className={styles.explanation}>Another version exists on disk. Nothing is overwritten until you choose. Autosave is paused for this document.</p>
      {changed && <p role="alert" className={styles.error}>A version changed while this comparison was open. Close and review again before replacing anything.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.comparison}>
        <label>On disk{review.disk.content === null ? ' · file deleted or moved' : ''}
          <textarea aria-label="Version on disk" readOnly value={review.disk.content ?? ''} spellCheck={false} />
        </label>
        <label>Your writing · edit here to merge
          <textarea aria-label="Merged document" value={merged} disabled={busy} onChange={e => setMerged(e.target.value)} spellCheck={false} />
        </label>
      </div>
      <details className={styles.diff} onToggle={e => setShowDiff(e.currentTarget.open)}>
        <summary>Highlight differences between disk and your original draft</summary>
        {showDiff && <>
          {fullSize > diffLimit && <p>Difference highlight shows only the first 12,000 characters. Both editors above contain the complete versions.</p>}
          <pre>{proseDiff((review.disk.content ?? '').slice(0, diffLimit), review.buffer.slice(0, diffLimit)).map((part, i) => <span key={i} className={styles[part.kind]}>{part.text}</span>)}</pre>
        </>}
      </details>
      <p className={styles.explanation}>Replacing your buffer keeps a local scratch copy. Replacing disk contents keeps the reviewed disk text as a scratch copy. These copies are covered by session recovery, not a version timeline.</p>
      <footer>
        <button disabled={busy} onClick={() => void run(async () => { if (await saveTabToDisk(review.id, { saveAs: true })) closeReview(); })}>Save local as…</button>
        <button disabled={busy || changed || review.disk.content === null || tab?.filePath !== review.targetPath} onClick={() => void run(useDisk)}>Use disk version</button>
        <button disabled={busy || changed} onClick={() => void run(() => save(false))}>Keep local · replace disk</button>
        <button className={styles.primary} disabled={busy || changed} onClick={() => void run(() => save(true))}>{busy ? 'Saving…' : 'Save merged version'}</button>
      </footer>
    </section>
  </div>;
}

/** A fixed, small notice; no new sidebar and no focus theft on external writes. */
export function SaveConflictNotice() {
  const tabs = useTabsStore(s => s.tabs);
  const active = useTabsStore(s => s.activeTabId);
  const [review, setReview] = useState<Review | null>(null);
  const affected = tabs.filter(t => t.conflict || t.diskError);
  const tab = affected.find(t => t.id === active) ?? affected[0];
  if (!tab && !review) return null;
  return <>
    {tab && <aside className={styles.notice} aria-label="Document save protection">
      <span role="status"><strong>{tab.title}</strong><span>{tab.conflict ? 'Disk changes need review. Your writing is safe.' : `Disk could not be checked: ${tab.diskError}`}{affected.length > 1 ? ` · ${affected.length} documents need attention` : ''}</span></span>
      {tab.conflict && <button onClick={() => { useTabsStore.getState().setActive(tab.id); setReview({ id: tab.id, ...tab.conflict!, buffer: tab.content }); }}>Review</button>}
      {!tab.conflict && <button onClick={() => void checkExternalDocuments(true).catch(() => {})}>Retry</button>}
      <button onClick={() => void saveTabToDisk(tab.id, { saveAs: true }).catch(() => {})}>Save as…</button>
    </aside>}
    {review && <ConflictReview review={review} onClose={() => setReview(null)} />}
  </>;
}
