import { t } from '../i18n';
import { useModal } from '../hooks/useModal';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hasTauri, ipc } from '../api/tauri';
import { useSettingsStore, useTabsStore } from '../store';
import { parseLatexLists, parseOutline } from '../store/outline';
import { normalizePath } from '../files/projectPaths';
import styles from './CommandPalette.module.css';

/** A file to open, or a place in the active document (Texifier's "Jump To"). */
export type QuickOpenItem =
  | { kind: 'file'; name: string; detail: string; path: string }
  | { kind: 'line'; name: string; detail: string; line: number };

/** Items whose name, then path, contains the query; then names whose letters
 *  merely appear in order. `:42` is line 42 of the active document. */
export function rankQuickOpen(items: QuickOpenItem[], query: string): QuickOpenItem[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return items;
  const line = /^:(\d+)$/.exec(q);
  if (line) return [{ kind: 'line', name: t('Line {line}', { line: Number(line[1]) }), detail: '', line: Number(line[1]) }];
  const inOrder = (text: string) => {
    let at = 0;
    for (const ch of q) if ((at = text.indexOf(ch, at) + 1) === 0) return false;
    return true;
  };
  const score = (item: QuickOpenItem) => {
    const name = item.name.toLocaleLowerCase(), all = `${name} ${item.detail.toLocaleLowerCase()}`;
    return name.startsWith(q) ? 0 : name.includes(q) ? 1 : all.includes(q) ? 2 : inOrder(name) ? 3 : -1;
  };
  return items.map(item => ({ item, rank: score(item) })).filter(entry => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank).map(entry => entry.item);
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export interface QuickOpenProps {
  open: boolean;
  onClose: () => void;
  folder: string | null;
  onOpenFile: (path: string) => void;
  onJumpToLine: (line: number) => void;
}

export function QuickOpen({ open, onClose, folder, onOpenFile, onJumpToLine }: QuickOpenProps) {
  const modal = useModal(open, onClose);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [folderFiles, setFolderFiles] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    let current = true;
    if (folder && hasTauri()) {
      void ipc.listWorkspaceDocuments(folder).then(paths => { if (current) setFolderFiles(paths); }, () => {});
    } else setFolderFiles([]);
    return () => { current = false; };
  }, [open, folder]);

  // Read once per opening: the dialog is modal, so the document cannot change meanwhile.
  const items = useMemo<QuickOpenItem[]>(() => {
    if (!open) return [];
    const { tabs, activeTabId } = useTabsStore.getState();
    const tab = tabs.find(item => item.id === activeTabId);
    const places: QuickOpenItem[] = [];
    if (tab) {
      for (const heading of parseOutline(tab.content, tab.lang)) {
        places.push({ kind: 'line', name: heading.title, detail: t('Line {line}', { line: heading.line }), line: heading.line });
      }
      if (tab.lang === 'latex') {
        for (const label of parseLatexLists(tab.content).labels) {
          places.push({ kind: 'line', name: label.title, detail: t('Line {line}', { line: label.line }), line: label.line });
        }
      }
    }
    const seen = new Set<string>();
    const files: QuickOpenItem[] = [];
    const root = folder ? normalizePath(folder).replace(/\/?$/, '/') : null;
    const add = (path: string | null) => {
      if (!path || seen.has(normalizePath(path))) return;
      seen.add(normalizePath(path));
      const shown = root && normalizePath(path).startsWith(root) ? normalizePath(path).slice(root.length) : path;
      files.push({ kind: 'file', name: fileName(path), detail: shown, path });
    };
    // Open tabs and recent files first, then the rest of the folder.
    for (const item of tabs) if (item.id !== activeTabId) add(item.filePath);
    for (const path of useSettingsStore.getState().settings.recent_files) add(path);
    for (const path of folderFiles) add(path);
    return [...files, ...places];
  }, [open, folder, folderFiles]);

  const shown = useMemo(() => rankQuickOpen(items, query).slice(0, 80), [items, query]);
  useEffect(() => { setActive(0); }, [query]);
  if (!open) return null;

  function choose(item?: QuickOpenItem) {
    if (!item) return;
    onClose();
    if (item.kind === 'file') onOpenFile(item.path);
    else onJumpToLine(item.line);
  }

  return (
    <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section {...modal} className={styles.palette} role="dialog" aria-label={t('Quick Open')}>
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); onClose(); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(shown.length - 1, i + 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(0, i - 1)); }
            else if (event.key === 'Enter') { event.preventDefault(); choose(shown[active]); }
          }}
          placeholder={t('File, heading, label, or :line…')}
          aria-label={t('Quick Open')}
        />
        <ul className={styles.list}>
          {shown.length === 0 ? <li className={styles.empty}>{t('No matches')}</li> : shown.map((item, i) => (
            <li
              key={item.kind === 'file' ? item.path : `line-${item.line}-${i}`}
              className={`${styles.item} ${i === active ? styles.active : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={event => { event.preventDefault(); choose(item); }}
            >
              <span className={styles.name}>{item.kind === 'line' ? `§ ${item.name}` : item.name}</span>
              {item.detail && <span className={styles.shortcut}>{item.detail}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
