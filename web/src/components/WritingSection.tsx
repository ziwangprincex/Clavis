import { useMemo, useState } from 'react';
import { useWritingStore } from '../store';
import styles from './WritingSection.module.css';

export interface WritingSectionProps {
  onActivate: (path: string, line: number) => void;
  onRefresh: () => void;
}

export function WritingSection({ onActivate, onRefresh }: WritingSectionProps) {
  const diagnostics = useWritingStore(s => s.diagnostics);
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? diagnostics.filter(item => `${item.code} ${item.message} ${item.path ?? ''}`.toLowerCase().includes(q)) : diagnostics;
  }, [diagnostics, filter]);
  return <div className={styles.root}>
    <div className={styles.tools}>
      <input value={filter} onChange={event => setFilter(event.target.value)} placeholder="filter writing checks…" />
      <button type="button" onClick={onRefresh} title="Refresh writing checks">↻</button>
    </div>
    {visible.length === 0 ? <div className={styles.empty}>No writing consistency issues.</div> : <ul className={styles.list}>
      {visible.map((item, index) => <li key={`${item.code}:${item.path}:${item.line}:${item.column}:${index}`} className={styles[item.severity]} onClick={() => item.path && onActivate(item.path, item.line)}>
        <span className={styles.code}>{item.code}</span>
        <span className={styles.message}>{item.message}</span>
        {item.path && <span className={styles.location}>{item.path.split(/[\\/]/).pop()}:{item.line}</span>}
      </li>)}
    </ul>}
  </div>;
}
