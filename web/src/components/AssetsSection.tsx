import { useMemo } from 'react';
import { ipc } from '../api/tauri';
import { useAssetsStore } from '../store';
import styles from './AssetsSection.module.css';

export interface AssetsSectionProps { root: string; onActivate: (path: string, line: number) => void; onRefresh: () => void; }
export function AssetsSection({ root, onActivate, onRefresh }: AssetsSectionProps) {
  const result = useAssetsStore(s => s.result); const loading = useAssetsStore(s => s.loading); const error = useAssetsStore(s => s.error);
  const assets = useMemo(() => [...(result?.assets ?? [])].sort((a,b) => a.usages.length - b.usages.length || a.relativePath.localeCompare(b.relativePath)), [result]);
  return <div className={styles.root}>
    <div className={styles.tools}><span>{assets.length} assets</span><button type="button" disabled={loading} onClick={onRefresh}>↻</button></div>
    {error && <div className={styles.error}>{error}</div>}
    {loading && <div className={styles.empty}>Indexing assets…</div>}
    {!loading && result && <>
      {result.diagnostics.length > 0 && <ul className={styles.diagnostics}>{result.diagnostics.map((item,index) => <li key={index} className={styles[item.severity]} onClick={() => item.path && item.line && onActivate(item.path,item.line)}>{item.message}</li>)}</ul>}
      <ul className={styles.list}>{assets.map(asset => <li key={asset.path} className={asset.usages.length ? styles.used : styles.unused}>
        <div><button type="button" className={styles.asset} onClick={() => void ipc.openArtifactPath(root, asset.path)}>{asset.relativePath}</button><span>{asset.extension} · {(asset.sizeBytes / 1024).toFixed(1)} KB</span></div>
        <div className={styles.usage}>{asset.usages.length} use{asset.usages.length === 1 ? '' : 's'}{asset.usages[0] && <button type="button" onClick={() => onActivate(asset.usages[0].sourcePath, asset.usages[0].line)}>Go to use</button>}</div>
      </li>)}</ul>
    </>}
    {!loading && !result && <div className={styles.empty}>Open a workspace to index assets.</div>}
  </div>;
}
