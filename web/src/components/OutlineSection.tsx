import { t } from '../i18n';
import { useMemo, useState } from 'react';
import { useTabsStore, useProjectStore, useCursorStore, useSettingsStore } from '../store';
import { parseLatexLists, parseOutline, parseProjectOutline, type OutlineItem, type OutlineListKind } from '../store/outline';
import { pathsEqual } from '../files/projectPaths';
import { useDebounced } from '../hooks/useDebounced';
import { SidebarSection } from './Sidebar';
import { IconChevronDown } from './icons';
import styles from './OutlineSection.module.css';

export interface OutlineSectionProps {
  /** Source file for project headings; null means the active document. */
  onJumpTo?: (absPath: string | null, line: number) => void;
}
interface OutlineNode extends OutlineItem { children: OutlineNode[] }

/** Every node with children, by its position in the tree ("0/2/1"). */
function branchPaths(nodes: OutlineNode[], prefix = ''): string[] {
  return nodes.flatMap((node, index) => {
    const path = `${prefix}${index}`;
    return node.children.length ? [path, ...branchPaths(node.children, `${path}/`)] : [];
  });
}

/** Shared by every row: which branches are folded and how deep the outline goes. */
interface TreeState { collapsed: ReadonlySet<string>; toggle: (path: string) => void; depth: number }

function hierarchy(items: OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const parents: OutlineNode[] = [];
  for (const item of items) {
    const node = { ...item, children: [] };
    while (parents.length && parents[parents.length - 1].level >= item.level) parents.pop();
    (parents.length ? parents[parents.length - 1].children : roots).push(node);
    parents.push(node);
  }
  return roots;
}

export function OutlineSection({ onJumpTo }: OutlineSectionProps) {
  const tabs = useTabsStore(s => s.tabs);
  const activeTabId = useTabsStore(s => s.activeTabId);
  const activeTab = tabs.find(tab => tab.id === activeTabId);
  const rootAbs = useProjectStore(s => s.rootAbs);
  const projectFiles = useProjectStore(s => s.files);
  const activeInProject = !!activeTab?.filePath && projectFiles.some(file => pathsEqual(file.absPath, activeTab.filePath));
  const useProject = !!rootAbs && activeTab?.lang === 'latex' && projectFiles.length > 0 && activeInProject;
  // Parsing is whole-document, so let typing settle first.
  const content = useDebounced(activeTab?.content, 300, activeTabId);
  const items = useMemo(() => useProject
    ? parseProjectOutline(projectFiles, activeTab?.filePath, content)
    : activeTab && content !== undefined ? parseOutline(content, activeTab.lang) : [],
  [useProject, projectFiles, activeTab?.filePath, content, activeTab?.lang]);
  const nodes = useMemo(() => hierarchy(items), [items]);
  // Texifier lists a LaTeX document's figures, tables, labels and citations under its outline.
  const lists = useMemo(() => activeTab?.lang === 'latex' && content !== undefined
    ? parseLatexLists(content, useProject ? projectFiles : undefined, activeTab.filePath) : null,
  [activeTab?.lang, content, useProject, projectFiles, activeTab?.filePath]);
  // The section the cursor is in reads bold, as in Typora's outline.
  const cursorLine = useCursorStore(s => s.line);
  const current = useMemo(() => {
    let found: OutlineItem | undefined;
    for (const item of items) {
      const here = !item.sourceFileAbsPath || pathsEqual(item.sourceFileAbsPath, activeTab?.filePath);
      if (here && item.line <= cursorLine && (!found || item.line >= found.line)) found = item;
    }
    return found && rowKey(found);
  }, [items, cursorLine, activeTab?.filePath]);
  const [query, setQuery] = useState('');
  // Typora's collapsible outline and heading depth; Texifier's level of detail.
  const depth = useSettingsStore(s => s.settings.outline_depth ?? 0);
  const patchAndSave = useSettingsStore(s => s.patchAndSave);
  // Folds belong to one document; positions in another document's tree mean nothing.
  const [folds, setFolds] = useState<Record<string, ReadonlySet<string>>>({});
  const collapsed = folds[activeTabId ?? ''] ?? NO_FOLDS;
  const setCollapsed = (next: ReadonlySet<string>) => setFolds(current => ({ ...current, [activeTabId ?? '']: next }));
  const branches = useMemo(() => branchPaths(nodes), [nodes]);
  const tree: TreeState = {
    collapsed,
    depth,
    toggle: path => {
      const next = new Set(collapsed);
      if (!next.delete(path)) next.add(path);
      setCollapsed(next);
    },
  };
  const hasLists = !!lists && LISTS.some(kind => lists[kind].length > 0);
  if (nodes.length === 0 && !hasLists) return null;
  // Formatted Markdown has no line-number gutter for a line label to refer to.
  const lines = activeTab?.lang !== 'markdown';
  const entries = [...items, ...(lists ? LISTS.flatMap(kind => lists[kind]) : [])];
  // A filter, as in Typora's and Texifier's outlines, once there is enough to filter.
  const filterable = entries.length >= FILTER_FROM;
  const needle = filterable ? query.trim().toLocaleLowerCase() : '';
  const matches = needle ? entries.filter(item => item.title.toLocaleLowerCase().includes(needle)) : [];
  const actions = branches.length > 0 && !needle ? <>
    <select className={styles.depth} value={depth} aria-label={t('Heading levels shown')} title={t('Heading levels shown')}
      onChange={event => void patchAndSave({ outline_depth: Number(event.target.value) })}>
      <option value={0}>{t('All levels')}</option>
      {[1, 2, 3, 4].map(level => <option key={level} value={level}>{t('{count} levels', { count: level })}</option>)}
    </select>
    <button type="button" className={styles.action} title={t('Expand all')} aria-label={t('Expand all')} onClick={() => setCollapsed(new Set())}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3M3 1.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
    </button>
    <button type="button" className={styles.action} title={t('Collapse all')} aria-label={t('Collapse all')} onClick={() => setCollapsed(new Set(branches))}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5l3-3 3 3M3 10.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
    </button>
  </> : undefined;
  return <SidebarSection title={t('Outline')} defaultOpen actions={actions}>
    {filterable && <input className={styles.filter} type="search" value={query} placeholder={t('Filter outline')}
      aria-label={t('Filter outline')} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} />}
    {needle ? <ul className={styles.list}>
      {matches.map((item, index) => <OutlineRow key={`${activeTabId}-match-${index}`} node={{ ...item, children: [] }} path={`m${index}`} level={1} tree={tree} lines={lines} current={current} onJumpTo={onJumpTo} />)}
      {!matches.length && <li className={styles.none}>{t('No matches')}</li>}
    </ul> : <>
      <ul className={styles.list}>
        {nodes.map((node, index) => <OutlineRow key={`${activeTabId}-${node.sourceFileAbsPath ?? ''}-${index}`} node={node} path={String(index)} level={1} tree={tree} lines={lines} current={current} onJumpTo={onJumpTo} />)}
      </ul>
      {hasLists && <ul className={`${styles.list} ${styles.lists}`}>
        {LISTS.map(kind => lists![kind].length > 0 && <OutlineList key={`${activeTabId}-${kind}`} kind={kind} items={lists![kind]} onJumpTo={onJumpTo} />)}
      </ul>}
    </>}
  </SidebarSection>;
}

const NO_FOLDS: ReadonlySet<string> = new Set();

/** Entries (headings and listed items) from which the outline offers a filter. */
const FILTER_FROM = 10;

const LISTS: OutlineListKind[] = ['figures', 'tables', 'labels', 'citations'];
/** Group icons, as Texifier marks its outline groups. */
const LIST_ICONS: Record<OutlineListKind, string> = {
  figures: 'M2 3h10v8H2zM2 9l3-3 2.5 2.5L9 7l3 3',
  tables: 'M2 3h10v8H2zM2 6h10M2 9h10M6 3v8',
  labels: 'M3 2h8v10l-4-2.6L3 12z',
  citations: 'M2.5 3c1.5-.7 3-.7 4.5 0v8.5c-1.5-.7-3-.7-4.5 0zM7 3c1.5-.7 3-.7 4.5 0v8.5c-1.5-.7-3-.7-4.5 0z',
};
const LIST_TITLES: Record<OutlineListKind, string> = { figures: 'Figures', tables: 'Tables', labels: 'Labels', citations: 'Citations' };

/** One collapsed group with its count, as Texifier shows them. */
function OutlineList({ kind, items, onJumpTo }: { kind: OutlineListKind; items: OutlineItem[] } & OutlineSectionProps) {
  const [open, setOpen] = useState(false);
  return <li>
    <div className={styles.row}>
      <button type="button" className={styles.toggle} aria-label={t(LIST_TITLES[kind])} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <IconChevronDown size={10} aria-hidden="true" className={open ? undefined : styles.closed} />
      </button>
      <button type="button" className={`${styles.item} ${styles.group}`} onClick={() => setOpen(value => !value)}>
        <svg className={styles.groupIcon} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.15" aria-hidden="true"><path d={LIST_ICONS[kind]} /></svg>
        <span className={styles.title}>{t(LIST_TITLES[kind])}</span><span className={styles.count}>{items.length}</span>
      </button>
    </div>
    <ul className={styles.children} hidden={!open}>
      {items.map((item, index) => <li key={index}>
        <div className={styles.row}>
          <span className={styles.toggle} />
          <button type="button" className={styles.item} onClick={() => onJumpTo?.(item.sourceFileAbsPath ?? null, item.line)}
            title={item.sourceFileAbsPath ? `${item.sourceFileAbsPath}:${item.line}` : t('Line {line}', { line: item.line })}>
            <span className={styles.title}>{item.title || t('Line {line}', { line: item.line })}</span><span className={styles.line}>L{item.line}</span>
          </button>
        </div>
      </li>)}
    </ul>
  </li>;
}

const rowKey = (item: OutlineItem) => `${item.sourceFileAbsPath ?? ''}:${item.line}`;

function OutlineRow({ node, path, level, tree, lines, current, onJumpTo }: { node: OutlineNode; path: string; level: number; tree: TreeState; lines: boolean; current?: string } & OutlineSectionProps) {
  // Below the chosen depth the children are not shown at all, so the branch has no toggle.
  const branch = node.children.length > 0 && (tree.depth === 0 || level < tree.depth);
  const open = !tree.collapsed.has(path);
  return <li>
    <div className={styles.row}>
      {branch ? <button type="button" className={styles.toggle} aria-label={node.title} aria-expanded={open} onClick={() => tree.toggle(path)}>
        <IconChevronDown size={10} aria-hidden="true" className={open ? undefined : styles.closed} />
      </button> : <span className={styles.toggle} />}
      <button type="button" className={`${styles.item} ${rowKey(node) === current ? styles.current : ''}`} aria-current={rowKey(node) === current ? 'location' : undefined} onClick={() => onJumpTo?.(node.sourceFileAbsPath ?? null, node.line)}
        title={node.sourceFileAbsPath ? `${node.sourceFileAbsPath}:${node.line}` : t('Line {line}', { line: node.line })}>
        <span className={styles.title}>{node.title}</span>{lines && <span className={styles.line}>L{node.line}</span>}
      </button>
    </div>
    {branch && <ul className={styles.children} hidden={!open}>
      {node.children.map((child, index) => <OutlineRow key={`${child.sourceFileAbsPath ?? ''}-${index}`} node={child} path={`${path}/${index}`} level={level + 1} tree={tree} lines={lines} current={current} onJumpTo={onJumpTo} />)}
    </ul>}
  </li>;
}
