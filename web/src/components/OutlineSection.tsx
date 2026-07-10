import { useMemo } from 'react';
import { useTabsStore, useProjectStore } from '../store';
import { parseOutline, parseProjectOutline } from '../store/outline';
import { pathsEqual } from '../files/projectPaths';
import styles from './OutlineSection.module.css';

export interface OutlineSectionProps {
  /**
   * Called when user clicks an outline entry. `absPath` is the heading's source
   * file when it belongs to a merged project outline (may differ from the active
   * tab), or null for a single-file outline — the caller then just scrolls the
   * active editor.
   */
  onJumpTo?: (absPath: string | null, line: number) => void;
}

export function OutlineSection({ onJumpTo }: OutlineSectionProps) {
  const tabs = useTabsStore(s => s.tabs);
  const activeTabId = useTabsStore(s => s.activeTabId);
  const activeTab = tabs.find(t => t.id === activeTabId);

  const rootAbs = useProjectStore(s => s.rootAbs);
  const projectFiles = useProjectStore(s => s.files);

  // Use the merged project outline only when a LaTeX project is active AND the
  // file on screen actually belongs to it — otherwise an unrelated .tex opened
  // while a project is loaded would wrongly show the old project's outline.
  const activeInProject =
    !!activeTab?.filePath && projectFiles.some(f => pathsEqual(f.absPath, activeTab.filePath));
  const useProject =
    !!rootAbs && activeTab?.lang === 'latex' && projectFiles.length > 0 && activeInProject;

  const items = useMemo(() => {
    if (useProject) {
      return parseProjectOutline(projectFiles, activeTab?.filePath, activeTab?.content);
    }
    if (!activeTab) return [];
    return parseOutline(activeTab.content, activeTab.lang);
  }, [useProject, projectFiles, activeTab?.filePath, activeTab?.content, activeTab?.lang]);

  if (!activeTab) {
    return <div className={styles.empty}>(no document)</div>;
  }
  if (items.length === 0) {
    return <div className={styles.empty}>(no headings)</div>;
  }

  return (
    <ul className={styles.list}>
      {items.map((item, i) => (
        <li
          key={`${item.sourceFileAbsPath ?? ''}-${item.line}-${item.level}-${i}`}
          className={styles.item}
          style={{ paddingLeft: 8 + item.level * 12 }}
          onClick={() => onJumpTo?.(item.sourceFileAbsPath ?? null, item.line)}
          title={item.sourceFileAbsPath ? `${item.sourceFileAbsPath}:${item.line}` : `Line ${item.line}`}
        >
          <span className={styles.title}>{item.title}</span>
          <span className={styles.line}>L{item.line}</span>
        </li>
      ))}
    </ul>
  );
}
