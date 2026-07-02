import { useTabsStore, type Tab, type Lang } from '../store';
import styles from './Tabs.module.css';

export interface TabsProps {
  onCloseTab?: (id: string) => void;
}

const LANG_LABEL: Record<Lang, string> = {
  markdown: 'MD',
  latex: 'TeX',
  typst: 'TYP',
};

function tabDisplayName(t: Tab): string {
  if (t.filePath) {
    const parts = t.filePath.split(/[\\/]/);
    return parts[parts.length - 1] || t.filePath;
  }
  return '(untitled)';
}

export function Tabs({ onCloseTab }: TabsProps) {
  const tabs = useTabsStore(s => s.tabs);
  const activeTabId = useTabsStore(s => s.activeTabId);
  const setActive = useTabsStore(s => s.setActive);
  const closeTab = useTabsStore(s => s.closeTab);

  if (tabs.length === 0) {
    return <div className={styles.empty}>(no tabs)</div>;
  }

  function onClose(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const tab = useTabsStore.getState().tabs.find(t => t.id === id);
    if (tab?.isDirty) {
      const ok = window.confirm(
        `"${tab.filePath ? tab.filePath.split(/[\\/]/).pop() : '(untitled)'}" has unsaved changes. Close anyway?`,
      );
      if (!ok) return;
    }
    if (onCloseTab) onCloseTab(id);
    else closeTab(id);
  }

  return (
    <div className={styles.bar} role="tablist">
      {tabs.map(t => (
        <div
          key={t.id}
          role="tab"
          tabIndex={t.id === activeTabId ? 0 : -1}
          aria-selected={t.id === activeTabId}
          className={`${styles.tab} ${t.id === activeTabId ? styles.active : ''}`}
          onClick={() => setActive(t.id)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setActive(t.id);
            } else if (e.key === 'Delete' || (e.key === 'w' && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              onClose(e as unknown as React.MouseEvent, t.id);
            }
          }}
          title={t.filePath ?? '(unsaved)'}
        >
          <span className={styles.langTag}>{LANG_LABEL[t.lang]}</span>
          <span className={styles.title}>{tabDisplayName(t)}</span>
          {t.isDirty && <span className={styles.dirty} aria-label="unsaved">●</span>}
          <button
            className={styles.close}
            onClick={e => onClose(e, t.id)}
            aria-label={`Close ${tabDisplayName(t)}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
