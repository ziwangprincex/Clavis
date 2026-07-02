import { useMemo } from 'react';
import { useTabsStore } from '../store';
import { parseOutline } from '../store/outline';
import styles from './OutlineSection.module.css';

export interface OutlineSectionProps {
  /** Called when user clicks an outline entry. Wired by App when EditorPane lands. */
  onJumpToLine?: (line: number) => void;
}

export function OutlineSection({ onJumpToLine }: OutlineSectionProps) {
  const tabs = useTabsStore(s => s.tabs);
  const activeTabId = useTabsStore(s => s.activeTabId);
  const activeTab = tabs.find(t => t.id === activeTabId);

  const items = useMemo(() => {
    if (!activeTab) return [];
    return parseOutline(activeTab.content, activeTab.lang);
  }, [activeTab?.content, activeTab?.lang]);

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
          key={`${item.line}-${item.level}-${i}`}
          className={styles.item}
          style={{ paddingLeft: 8 + item.level * 12 }}
          onClick={() => onJumpToLine?.(item.line)}
          title={`Line ${item.line}`}
        >
          <span className={styles.title}>{item.title}</span>
          <span className={styles.line}>L{item.line}</span>
        </li>
      ))}
    </ul>
  );
}
