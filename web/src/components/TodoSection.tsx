import { t } from '../i18n';
import { useMemo } from 'react';
import { useTabsStore } from '../store';
import { useDebounced } from '../hooks/useDebounced';
import { findTodos } from '../writing/todos';
import { SidebarSection } from './Sidebar';
import styles from './OutlineSection.module.css';

/** To-do notes in the active document; hidden when there are none. */
export function TodoSection({ onJumpTo }: { onJumpTo?: (line: number) => void }) {
  const activeTabId = useTabsStore(s => s.activeTabId);
  const lang = useTabsStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.lang);
  const content = useDebounced(useTabsStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.content), 300, activeTabId);
  const todos = useMemo(() => content && lang ? findTodos(content, lang) : [], [content, lang]);
  if (!todos.length) return null;
  return <SidebarSection title={t('To-dos ({count})', { count: todos.length })} defaultOpen>
    <ul className={styles.list}>
      {todos.map(todo => <li key={`${activeTabId}-${todo.line}`}>
        <div className={styles.row}>
          <span className={styles.toggle} />
          <button type="button" className={styles.item} onClick={() => onJumpTo?.(todo.line)} title={t('Line {line}', { line: todo.line })}>
            <span className={styles.title}>{todo.text}</span>
          </button>
        </div>
      </li>)}
    </ul>
  </SidebarSection>;
}
