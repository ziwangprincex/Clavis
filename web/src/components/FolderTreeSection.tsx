import { t } from '../i18n';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ipc, type TreeNode } from '../api/tauri';
import { useTabsStore } from '../store';
import { pathsEqual } from '../files/projectPaths';
import { IconChevronDown, IconClose, IconDoc, IconFolder } from './icons';
import styles from './FolderTreeSection.module.css';

export interface FolderTreeSectionProps {
  rootPath: string | null;
  onOpenFolder?: () => void;
  onCloseFolder?: () => void;
  onFileActivate?: (absPath: string) => void;
  /** Command-palette refresh; foregrounding also refreshes the visible tree. */
  refreshKey?: number;
}

interface NodeWithChildren extends TreeNode {
  loaded: boolean;
  expanded: boolean;
  children: NodeWithChildren[];
}

function adopt(n: TreeNode): NodeWithChildren {
  return { ...n, loaded: false, expanded: false, children: (n.children ?? []).map(adopt) };
}

// Re-scan only expanded directories, preserving their open state. Closed
// directories are lazy-loaded again when opened, not crawled in the background.
async function scan(path: string, previous: NodeWithChildren | null): Promise<NodeWithChildren> {
  const fresh = adopt(await ipc.scanFolderShallow(path));
  const oldChildren = new Map(previous?.children.map(child => [child.path, child]));
  fresh.children = await Promise.all(fresh.children.map(async child => {
    const old = oldChildren.get(child.path);
    if (!child.isDir || !old?.expanded) return child;
    return scan(child.path, old);
  }));
  return { ...fresh, loaded: true, expanded: true };
}

function replaceNode(root: NodeWithChildren, next: NodeWithChildren): NodeWithChildren {
  if (root.path === next.path) return next;
  return { ...root, children: root.children.map(child => replaceNode(child, next)) };
}

export function FolderTreeSection({ rootPath, onOpenFolder, onCloseFolder, onFileActivate, refreshKey = 0 }: FolderTreeSectionProps) {
  const [root, setRoot] = useState<NodeWithChildren | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const currentRoot = useRef(root);
  currentRoot.current = root;
  const request = useRef(0);
  const treeId = useId();
  const activePath = useTabsStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.filePath);

  const loadRoot = useCallback(async () => {
    const seq = ++request.current;
    if (!rootPath) { setRoot(null); setError(null); return; }
    try {
      const previous = currentRoot.current?.path === rootPath ? currentRoot.current : null;
      const fresh = await scan(rootPath, previous);
      if (seq !== request.current) return;
      setRoot(fresh);
      setError(null);
    } catch (e) {
      if (seq === request.current) setError(String(e));
    }
  }, [rootPath]);

  useEffect(() => {
    setCollapsed(false);
    setError(null);
  }, [rootPath]);

  useEffect(() => {
    void loadRoot();
    return () => { request.current += 1; };
  }, [loadRoot, refreshKey]);

  useEffect(() => {
    if (!rootPath) return;
    const foreground = () => {
      if (document.visibilityState !== 'hidden') void loadRoot();
    };
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [rootPath, loadRoot]);

  async function expand(node: NodeWithChildren) {
    if (!node.isDir) { onFileActivate?.(node.path); return; }
    const seq = ++request.current;
    try {
      const next = node.loaded ? { ...node, expanded: !node.expanded } : await scan(node.path, node);
      if (seq !== request.current) return;
      setRoot(previous => previous ? replaceNode(previous, next) : null);
      setError(null);
    } catch (e) {
      if (seq === request.current) setError(String(e));
    }
  }

  if (!rootPath) {
    return <button type="button" className={styles.openFolder} onClick={onOpenFolder}>
      <IconFolder size={14} aria-hidden="true" />{t('Open folder')}
    </button>;
  }
  const visibleRoot = root?.path === rootPath ? root : null;
  const name = visibleRoot?.name ?? rootPath.split(/[\\/]/).filter(Boolean).pop();
  return (
    <section className={styles.root}>
      <div className={styles.header}>
        <button type="button" className={styles.folderTitle} title={rootPath} aria-expanded={!collapsed} aria-controls={treeId} onClick={() => setCollapsed(value => !value)}>
          <IconChevronDown size={11} aria-hidden="true" className={`${styles.caret} ${collapsed ? styles.iconClosed : ''}`} />
          <IconFolder size={14} aria-hidden="true" />
          <span className={styles.name}>{name}</span>
        </button>
        <button type="button" className={styles.btn} onClick={onCloseFolder} aria-label={t('Close folder')} title={t('Close folder')}>
          <IconClose size={11} aria-hidden="true" />
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <ul id={treeId} className={styles.tree} hidden={collapsed} aria-label={name}>
        {visibleRoot?.children.map(node => <TreeRow key={node.path} node={node} activePath={activePath} onActivate={expand} />)}
      </ul>
    </section>
  );
}

function TreeRow({ node, activePath, onActivate }: {
  node: NodeWithChildren;
  activePath: string | null | undefined;
  onActivate: (node: NodeWithChildren) => void;
}) {
  const active = !node.isDir && pathsEqual(node.path, activePath);
  return <li>
    <button type="button" className={`${styles.row} ${active ? styles.active : ''}`} title={node.path}
      aria-current={active ? 'page' : undefined} aria-expanded={node.isDir ? node.expanded : undefined} onClick={() => onActivate(node)}>
      {node.isDir ? <IconChevronDown size={10} aria-hidden="true" className={`${styles.caret} ${node.expanded ? '' : styles.iconClosed}`} /> : <span className={styles.caret} />}
      {node.isDir ? <IconFolder size={14} aria-hidden="true" className={styles.icon} /> : <IconDoc size={13} aria-hidden="true" className={styles.icon} />}
      <span className={styles.label}>{node.name}</span>
    </button>
    {node.isDir && node.expanded && <ul className={styles.children} aria-label={node.name}>
      {node.children.map(child => <TreeRow key={child.path} node={child} activePath={activePath} onActivate={onActivate} />)}
    </ul>}
  </li>;
}
