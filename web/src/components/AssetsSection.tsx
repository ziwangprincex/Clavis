import { useMemo, useState } from 'react';
import { ipc } from '../api/tauri';
import { useAssetsStore, type Lang } from '../store';
import { assetInsertText } from '../assets/insert';
import styles from './AssetsSection.module.css';

export interface AssetsSectionProps {
  root: string;
  language: Lang;
  onActivate: (path: string, line: number) => void;
  onInsert: (text: string) => void;
  onRefresh: () => void;
}

export function AssetsSection({ root, language, onActivate, onInsert, onRefresh }: AssetsSectionProps) {
  const result = useAssetsStore(s => s.result); const loading = useAssetsStore(s => s.loading); const error = useAssetsStore(s => s.error);
  const assets = useMemo(() => [...(result?.assets ?? [])].sort((a, b) => a.usages.length - b.usages.length || a.relativePath.localeCompare(b.relativePath)), [result]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  async function togglePreview(path: string) {
    if (previewPath === path) { setPreviewPath(null); setPreview(null); setPreviewError(null); setPreviewLoaded(false); return; }
    setPreviewPath(path); setPreview(null); setPreviewError(null); setPreviewLoaded(false);
    try { setPreview(await ipc.assetPreview(root, path)); setPreviewLoaded(true); }
    catch (reason) { setPreviewError(String(reason)); setPreviewLoaded(true); }
  }

  return <div className={styles.root}>
    <div className={styles.tools}><span>{assets.length} assets</span><button type="button" disabled={loading} onClick={onRefresh}>?</button></div>
    {error && <div className={styles.error}>{error}</div>}
    {loading && <div className={styles.empty}>Indexing assets?</div>}
    {!loading && result && <>
      {result.diagnostics.length > 0 && <ul className={styles.diagnostics}>{result.diagnostics.map((item, index) => <li key={index} className={styles[item.severity]} onClick={() => item.path && item.line && onActivate(item.path, item.line)}>{item.message}</li>)}</ul>}
      <ul className={styles.list}>{assets.map(asset => <li key={asset.path} className={asset.usages.length ? styles.used : styles.unused}>
        <div><button type="button" className={styles.asset} onClick={() => void ipc.openArtifactPath(root, asset.path)}>{asset.relativePath}</button><span>{asset.extension} ? {(asset.sizeBytes / 1024).toFixed(1)} KB</span></div>
        <div className={styles.usage}><span>{asset.usages.length} use{asset.usages.length === 1 ? '' : 's'}</span><div><button type="button" onClick={() => void togglePreview(asset.path)}>{previewPath === asset.path ? 'Hide preview' : 'Preview'}</button><button type="button" onClick={() => onInsert(assetInsertText(asset.relativePath, language))}>Insert</button>{asset.usages[0] && <button type="button" onClick={() => onActivate(asset.usages[0].sourcePath, asset.usages[0].line)}>Go to use</button>}</div></div>
        {previewPath === asset.path && <div className={styles.preview}>{preview ? <img src={preview} alt={`Preview of ${asset.relativePath}`} /> : previewError ? <span>{previewError}</span> : previewLoaded ? <span>Preview unavailable for this format or file size.</span> : <span>Loading preview?</span>}</div>}
      </li>)}</ul>
    </>}
    {!loading && !result && <div className={styles.empty}>Open a workspace to index assets.</div>}
  </div>;
}
