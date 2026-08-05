import { useMemo, useState } from 'react';
import { useReferencesStore } from '../store';
import styles from './ReferencesSection.module.css';

export interface ReferencesSectionProps {
  onActivate: (path: string, line: number) => void;
  onRefresh: () => void;
}

export function ReferencesSection({ onActivate, onRefresh }: ReferencesSectionProps) {
  const result = useReferencesStore(s => s.result);
  const loading = useReferencesStore(s => s.loading);
  const error = useReferencesStore(s => s.error);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = filter.trim().toLowerCase();

  const diagnostics = useMemo(() => {
    const all = result?.diagnostics ?? [];
    return q ? all.filter(item => `${item.key} ${item.message} ${item.path ?? ''}`.toLowerCase().includes(q)) : all;
  }, [result, q]);

  const symbols = useMemo(() => {
    type Item = NonNullable<typeof result>['occurrences'][number];
    const grouped = new Map<string, { namespace: string; key: string; definitions: Item[]; usages: Item[] }>();
    for (const item of result?.occurrences ?? []) {
      if (!['label', 'citation'].includes(item.namespace)) continue;
      const id = `${item.namespace}:${item.key}`;
      const group = grouped.get(id) ?? { namespace: item.namespace, key: item.key, definitions: [], usages: [] };
      (item.role === 'definition' ? group.definitions : group.usages).push(item);
      grouped.set(id, group);
    }
    return [...grouped.values()]
      .filter(group => !q || `${group.namespace} ${group.key}`.toLowerCase().includes(q))
      .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key));
  }, [result, q]);

  return (
    <div className={styles.root}>
      <div className={styles.tools}>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter references?" />
        <button type="button" onClick={onRefresh} disabled={loading} title="Refresh reference index">?</button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {!error && loading && <div className={styles.empty}>Indexing?</div>}
      {!error && !loading && !result && <div className={styles.empty}>Open a workspace to index references.</div>}
      {result && (
        <>
          <div className={styles.summary}>{result.occurrences.length} occurrences ? {result.diagnostics.length} issues{result.truncated ? ' ? truncated' : ''}</div>
          <div className={styles.subhead}>Issues</div>
          {diagnostics.length === 0 ? <div className={styles.empty}>No reference issues.</div> : (
            <ul className={styles.list}>{diagnostics.map((item, index) => (
              <li key={`${item.code}:${item.path}:${item.line}:${item.key}:${index}`} className={styles[item.severity]} onClick={() => item.path && item.line && onActivate(item.path, item.line)}>
                <span className={styles.code}>{item.code}</span><span className={styles.message}>{item.message}</span>
                {item.path && <span className={styles.location}>{item.path.split(/[\\/]/).pop()}:{item.line ?? 1}</span>}
              </li>
            ))}</ul>
          )}
          <div className={styles.subhead}>Symbols</div>
          <ul className={styles.symbols}>{symbols.map(group => {
            const id = `${group.namespace}:${group.key}`;
            const definition = group.definitions[0];
            return <li key={id}>
              <div className={styles.symbolRow}>
                <button type="button" className={styles.expand} onClick={() => setExpanded(expanded === id ? null : id)}>{expanded === id ? '?' : '?'}</button>
                <button type="button" className={styles.symbolName} onClick={() => definition && onActivate(definition.path, definition.line)} title={definition ? 'Go to definition' : 'No definition'}>
                  <span>{group.key}</span><small>{group.namespace} ? {group.usages.length} refs</small>
                </button>
              </div>
              {expanded === id && <ul className={styles.usages}>
                {group.definitions.map((item, i) => <li key={`d${i}`} onClick={() => onActivate(item.path, item.line)}>def ? {item.relativePath}:{item.line}</li>)}
                {group.usages.map((item, i) => <li key={`u${i}`} onClick={() => onActivate(item.path, item.line)}>ref ? {item.relativePath}:{item.line}</li>)}
              </ul>}
            </li>;
          })}</ul>
        </>
      )}
    </div>
  );
}
