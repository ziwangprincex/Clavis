import { t } from '../i18n';
import { useMemo, useState } from 'react';
import { useTabsStore, useProjectStore, useCursorStore } from '../store';
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
  const hasLists = !!lists && LISTS.some(kind => lists[kind].length > 0);
  if (nodes.length === 0 && !hasLists) return null;
  // Formatted Markdown has no line-number gutter for a line label to refer to.
  const lines = activeTab?.lang !== 'markdown';
  const entries = [...items, ...(lists ? LISTS.flatMap(kind => lists[kind]) : [])];
  // A filter, as in Typora's and Texifier's outlines, once there is enough to filter.
  const filterable = entries.length >= FILTER_FROM;
  const needle = filterable ? query.trim().toLocaleLowerCase() : '';
  const matches = needle ? entries.filter(item => item.title.toLocaleLowerCase().includes(needle)) : [];
  return <SidebarSection title={t('Outline')} defaultOpen>
    {filterable && <input className={styles.filter} type="search" value={query} placeholder={t('Filter outline')}
      aria-label={t('Filter outline')} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} />}
    {needle ? <ul className={styles.list}>
      {matches.map((item, index) => <OutlineRow key={`${activeTabId}-match-${index}`} node={{ ...item, children: [] }} lines={lines} current={current} onJumpTo={onJumpTo} />)}
      {!matches.length && <li className={styles.none}>{t('No matches')}</li>}
    </ul> : <>
      <ul className={styles.list}>
        {nodes.map((node, index) => <OutlineRow key={`${activeTabId}-${node.sourceFileAbsPath ?? ''}-${index}`} node={node} lines={lines} current={current} onJumpTo={onJumpTo} />)}
      </ul>
      {hasLists && <ul className={`${styles.list} ${styles.lists}`}>
        {LISTS.map(kind => lists![kind].length > 0 && <OutlineList key={`${activeTabId}-${kind}`} kind={kind} items={lists![kind]} onJumpTo={onJumpTo} />)}
      </ul>}
    </>}
  </SidebarSection>;
}

/** Entries (headings and listed items) from which the outline offers a filter. */
const FILTER_FROM = 10;

const LISTS: OutlineListKind[] = ['figures', 'tables', 'labels', 'citations'];
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

function OutlineRow({ node, lines, current, onJumpTo }: { node: OutlineNode; lines: boolean; current?: string } & OutlineSectionProps) {
  const [open, setOpen] = useState(true);
  return <li>
    <div className={styles.row}>
      {node.children.length > 0 ? <button type="button" className={styles.toggle} aria-label={node.title} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <IconChevronDown size={10} aria-hidden="true" className={open ? undefined : styles.closed} />
      </button> : <span className={styles.toggle} />}
      <button type="button" className={`${styles.item} ${rowKey(node) === current ? styles.current : ''}`} aria-current={rowKey(node) === current ? 'location' : undefined} onClick={() => onJumpTo?.(node.sourceFileAbsPath ?? null, node.line)}
        title={node.sourceFileAbsPath ? `${node.sourceFileAbsPath}:${node.line}` : t('Line {line}', { line: node.line })}>
        <span className={styles.title}>{node.title}</span>{lines && <span className={styles.line}>L{node.line}</span>}
      </button>
    </div>
    {node.children.length > 0 && <ul className={styles.children} hidden={!open}>
      {node.children.map((child, index) => <OutlineRow key={`${child.sourceFileAbsPath ?? ''}-${index}`} node={child} lines={lines} current={current} onJumpTo={onJumpTo} />)}
    </ul>}
  </li>;
}
