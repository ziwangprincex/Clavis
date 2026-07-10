import { useCallback, useEffect, useState } from 'react';
import { ipc, type TreeNode } from '../api/tauri';
import { IconFolder } from './icons';
import styles from './FolderTreeSection.module.css';

export interface FolderTreeSectionProps {
  rootPath: string | null;
  onOpenFolder?: () => void;
  onCloseFolder?: () => void;
  onFileActivate?: (absPath: string) => void;
  onRefresh?: () => void;
  /** Bumped externally to force a re-scan (e.g. after refresh button click) */
  refreshKey?: number;
}

interface NodeWithChildren extends TreeNode {
  loaded: boolean;
  expanded: boolean;
  children: NodeWithChildren[];
}

function adopt(n: TreeNode): NodeWithChildren {
  return {
    ...n,
    loaded: false,
    expanded: false,
    children: (n.children ?? []).map(adopt),
  };
}

export function FolderTreeSection({
  rootPath,
  onOpenFolder,
  onCloseFolder,
  onFileActivate,
  onRefresh,
  refreshKey = 0,
}: FolderTreeSectionProps) {
  const [root, setRoot] = useState<NodeWithChildren | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRoot = useCallback(async () => {
    if (!rootPath) {
      setRoot(null);
      return;
    }
    try {
      const node = await ipc.scanFolderShallow(rootPath);
      const adopted = adopt(node);
      adopted.loaded = true;
      adopted.expanded = true;
      setRoot(adopted);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [rootPath]);

  useEffect(() => {
    void loadRoot();
  }, [loadRoot, refreshKey]);

  async function expand(node: NodeWithChildren) {
    if (!node.isDir) {
      onFileActivate?.(node.path);
      return;
    }
    if (!node.loaded) {
      try {
        const fresh = await ipc.scanFolderShallow(node.path);
        node.children = (fresh.children ?? []).map(adopt);
        node.loaded = true;
      } catch (e) {
        setError(String(e));
        return;
      }
    }
    node.expanded = !node.expanded;
    // Force re-render by cloning the root.
    setRoot(r => (r ? { ...r } : null));
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.name}>{rootPath ? root?.name ?? '…' : '(none)'}</span>
        <button className={styles.btn} onClick={onOpenFolder} title="Open folder"><IconFolder size={13} /></button>
        <button className={styles.btn} onClick={onRefresh} title="Rescan">⟳</button>
        {rootPath && (
          <button className={styles.btn} onClick={onCloseFolder} title="Close folder">×</button>
        )}
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {!rootPath && !error && (
        <div className={styles.empty}>No folder open</div>
      )}
      {root && root.children.length > 0 && (
        <ul className={styles.tree}>
          {root.children.map((c, i) => (
            <TreeRow key={i} node={c} depth={0} onActivate={expand} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  onActivate,
}: {
  node: NodeWithChildren;
  depth: number;
  onActivate: (n: NodeWithChildren) => void;
}) {
  return (
    <>
      <li
        className={styles.row}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onActivate(node)}
      >
        <span className={styles.icon}>{node.isDir ? (node.expanded ? '▾' : '▸') : '·'}</span>
        <span className={styles.label}>{node.name}</span>
      </li>
      {node.isDir && node.expanded && node.children.length > 0 && (
        <>
          {node.children.map((c, i) => (
            <TreeRow key={i} node={c} depth={depth + 1} onActivate={onActivate} />
          ))}
        </>
      )}
    </>
  );
}
