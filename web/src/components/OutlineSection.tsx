import { t } from '../i18n';
import { useMemo, useState } from 'react';
import { useTabsStore, useProjectStore } from '../store';
import { parseOutline, parseProjectOutline, type OutlineItem } from '../store/outline';
import { pathsEqual } from '../files/projectPaths';
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
  const nodes = useMemo(() => hierarchy(useProject
    ? parseProjectOutline(projectFiles, activeTab?.filePath, activeTab?.content)
    : activeTab ? parseOutline(activeTab.content, activeTab.lang) : []),
  [useProject, projectFiles, activeTab?.filePath, activeTab?.content, activeTab?.lang]);
  if (nodes.length === 0) return null;
  return <SidebarSection title={t('Outline')} defaultOpen>
    <ul className={styles.list}>
      {nodes.map((node, index) => <OutlineRow key={`${activeTabId}-${node.sourceFileAbsPath ?? ''}-${index}`} node={node} onJumpTo={onJumpTo} />)}
    </ul>
  </SidebarSection>;
}

function OutlineRow({ node, onJumpTo }: { node: OutlineNode } & OutlineSectionProps) {
  const [open, setOpen] = useState(true);
  return <li>
    <div className={styles.row}>
      {node.children.length > 0 ? <button type="button" className={styles.toggle} aria-label={node.title} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <IconChevronDown size={10} aria-hidden="true" className={open ? undefined : styles.closed} />
      </button> : <span className={styles.toggle} />}
      <button type="button" className={styles.item} onClick={() => onJumpTo?.(node.sourceFileAbsPath ?? null, node.line)}
        title={node.sourceFileAbsPath ? `${node.sourceFileAbsPath}:${node.line}` : t('Line {line}', { line: node.line })}>
        <span className={styles.title}>{node.title}</span><span className={styles.line}>L{node.line}</span>
      </button>
    </div>
    {node.children.length > 0 && <ul className={styles.children} hidden={!open}>
      {node.children.map((child, index) => <OutlineRow key={`${child.sourceFileAbsPath ?? ''}-${index}`} node={child} onJumpTo={onJumpTo} />)}
    </ul>}
  </li>;
}
