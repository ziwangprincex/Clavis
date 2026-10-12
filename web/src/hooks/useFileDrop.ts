// Subscribes to OS file-drop events: dropping a file opens it, dropping a
// folder sets the workspace. Images dropped on a saved Markdown document are
// inserted as links instead, copied beside it when they live elsewhere.

import { useEffect } from 'react';
import { hasTauri, events, ipc } from '../api/tauri';
import { openFileByPath } from '../files/files';
import { useTabsStore } from '../store';
import { setStatus } from '../store/status';

const IMAGE = /\.(?:png|jpe?g|gif|webp|svg)$/i;

async function insertImages(document: string, paths: string[], insert: (text: string) => void) {
  const links: string[] = [];
  for (const path of paths) {
    try {
      const relative = await ipc.placeMarkdownImage(document, path);
      links.push(`![](${/\s/.test(relative) ? `<${relative}>` : relative})`);
    } catch (error) {
      setStatus(`Image not added: ${String(error)}`, 'error');
    }
  }
  if (links.length) insert(links.join('\n'));
}

export function useFileDrop(onDropFolder: (path: string) => void, insertText: (text: string) => void): void {
  useEffect(() => {
    if (!hasTauri()) return;
    let off: (() => void) | undefined;
    events.onFileDrop(paths => {
      if (!paths?.length) return;
      const { tabs, activeTabId } = useTabsStore.getState();
      const active = tabs.find(tab => tab.id === activeTabId);
      if (active?.lang === 'markdown' && active.filePath && paths.every(path => IMAGE.test(path))) {
        void insertImages(active.filePath, paths, insertText);
        return;
      }
      const first = paths[0];
      // Heuristic: directories don't have an extension. Better would be to
      // call fs.exists or stat, but the legacy code took the same shortcut.
      const looksLikeDir = !/\.[^\\/]+$/.test(first);
      if (looksLikeDir) onDropFolder(first);
      else void openFileByPath(first);
    }).then(unlisten => {
      off = unlisten;
    });
    return () => off?.();
    // Registered once; both callbacks only read refs and stores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
