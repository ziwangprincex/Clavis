// BibSection — bibliography entries parsed from .bib files in the active
// LaTeX project. Filterable; double-click inserts \cite{key} at the cursor
// (wired by App when EditorPane lands).

import { useEffect, useMemo, useState } from 'react';
import { ipc, type BibEntry } from '../api/tauri';
import { useProjectStore } from '../store';
import styles from './BibSection.module.css';

export interface BibSectionProps {
  /** Called when user double-clicks an entry. */
  onInsertCite?: (key: string) => void;
  /** Called to jump to the entry's definition in its .bib file. */
  onJumpToSource?: (absPath: string, line: number) => void;
}

const MAX_VISIBLE = 200;

export function BibSection({ onInsertCite, onJumpToSource }: BibSectionProps) {
  const files = useProjectStore(s => s.files);
  const [entries, setEntries] = useState<BibEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const bibPaths = useMemo(
    () => files.filter(f => f.isBib).map(f => f.absPath),
    [files],
  );
  const sig = bibPaths.join('|');

  useEffect(() => {
    if (bibPaths.length === 0) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    ipc
      .parseBib(bibPaths)
      .then(list => {
        if (!cancelled) {
          setEntries(list);
          setError(null);
        }
      })
      .catch(e => {
        if (!cancelled) {
          setEntries([]);
          setError(String(e));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      b =>
        b.key.toLowerCase().includes(q) ||
        (b.title ?? '').toLowerCase().includes(q) ||
        (b.author ?? '').toLowerCase().includes(q),
    );
  }, [entries, filter]);

  const visible = filtered.slice(0, MAX_VISIBLE);
  const hidden = Math.max(0, filtered.length - MAX_VISIBLE);

  if (bibPaths.length === 0) {
    return <div className={styles.empty}>(no .bib files in project)</div>;
  }

  return (
    <div className={styles.root}>
      <input
        className={styles.filter}
        type="search"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="filter key/title/author…"
      />
      {error && <div className={styles.error}>{error}</div>}
      {entries.length === 0 && !error ? (
        <div className={styles.empty}>(no .bib entries)</div>
      ) : (
        <ul className={styles.list}>
          {visible.map(b => (
            <li
              key={b.key}
              className={styles.item}
              title={`${b.key}\n${b.title ?? ''}\n${b.author ?? ''} ${b.year ?? ''}\n\nDouble-click: insert \\cite · ↗: open in .bib`}
              onDoubleClick={() => onInsertCite?.(b.key)}
            >
              <span className={styles.key}>{b.key}</span>
              <span className={styles.meta}>{b.title ?? b.entryType}</span>
              {onJumpToSource && b.sourceFile && (
                <button
                  className={styles.jump}
                  title={`Open ${b.sourceFile} at line ${b.sourceLine}`}
                  onClick={e => {
                    e.stopPropagation();
                    onJumpToSource(b.sourceFile, b.sourceLine);
                  }}
                  onDoubleClick={e => e.stopPropagation()}
                >
                  ↗
                </button>
              )}
            </li>
          ))}
          {hidden > 0 && (
            <li className={styles.empty}>… {hidden} more (refine filter)</li>
          )}
        </ul>
      )}
    </div>
  );
}
