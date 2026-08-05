import { useMemo } from 'react';
import { ipc } from '../api/tauri';
import { useArtifactsStore, useTaskStore } from '../store';
import styles from './ArtifactsSection.module.css';

export interface ArtifactsSectionProps {
  root: string;
  onRunTask: (task: string) => void;
  onRefresh?: () => void;
}

const ORDER = { missing: 0, stale: 1, ready: 2 } as const;

export function ArtifactsSection({ root, onRunTask, onRefresh }: ArtifactsSectionProps) {
  const items = useArtifactsStore(s => s.items);
  const loading = useArtifactsStore(s => s.loading);
  const error = useArtifactsStore(s => s.error);
  const taskStatus = useTaskStore(s => s.status);
  const sorted = useMemo(
    () => [...items].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name)),
    [items],
  );

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span>{items.length} declared</span>
        <button type="button" onClick={onRefresh} disabled={loading} title="Refresh artifacts">↻</button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {!error && loading && <div className={styles.empty}>Checking artifacts…</div>}
      {!error && !loading && sorted.length === 0 && <div className={styles.empty}>(no artifacts declared)</div>}
      <ul className={styles.list}>
        {sorted.map(item => (
          <li key={item.name} className={`${styles.item} ${styles[item.status]}`}>
            <div className={styles.heading}>
              <span className={styles.dot} title={item.status} />
              <span className={styles.name}>{item.name}</span>
              <span className={styles.kind}>{item.kind}</span>
            </div>
            <div className={styles.path}>{item.relativePath}</div>
            {item.description && <div className={styles.description}>{item.description}</div>}
            <div className={styles.reason}>{item.reason}</div>
            {item.sources.length > 0 && (
              <div className={styles.sources} title={item.sources.map(source => `${source.exists ? '✓' : '×'} ${source.relativePath}`).join('\n')}>
                {item.sources.length} source{item.sources.length === 1 ? '' : 's'}
              </div>
            )}
            <div className={styles.actions}>
              {item.status !== 'missing' && (
                <button type="button" onClick={() => void ipc.openArtifactPath(root, item.path)}>Open</button>
              )}
              {item.task && (
                <button type="button" disabled={taskStatus === 'running'} onClick={() => onRunTask(item.task!)}>
                  Run {item.task}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
