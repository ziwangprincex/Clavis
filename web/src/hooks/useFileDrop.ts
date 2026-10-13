// Subscribes to OS file-drop events: dropping a file opens it, dropping a
// folder sets the workspace. Images dropped on a saved Markdown document are
// inserted as links instead, copied beside it when they live elsewhere.

import { useEffect } from 'react';
import { hasTauri, events, ipc } from '../api/tauri';
import { openFileByPath } from '../files/files';
import { pathsEqual } from '../files/projectPaths';
import { imageMarkdown } from '../editor/markdownEditing';
import { useTabsStore } from '../store';
import { setStatus } from '../store/status';

const IMAGE = /\.(?:png|jpe?g|gif|webp|svg)$/i;

const activeTab = () => {
  const { tabs, activeTabId } = useTabsStore.getState();
  return tabs.find(tab => tab.id === activeTabId);
};

async function insertImages(document: string, paths: string[], insert: (text: string) => void) {
  const placed = await Promise.all(paths.map(path => ipc.placeMarkdownImage(document, path).catch((error: unknown) => {
    setStatus(`Image not added: ${String(error)}`, 'error');
    return null;
  })));
  const relative = placed.filter((path): path is string => !!path);
  if (!relative.length) return;
  // The paths are relative to the document the drop landed on, which may no longer be shown.
  if (!pathsEqual(activeTab()?.filePath, document)) {
    setStatus('The image was saved beside its document but not inserted: another document is open now.', 'info');
    return;
  }
  insert(relative.map(imageMarkdown).join('\n'));
}

export function useFileDrop(onDropFolder: (path: string) => void, insertText: (text: string) => void): void {
  useEffect(() => {
    if (!hasTauri()) return;
    let off: (() => void) | undefined;
    events.onFileDrop(paths => {
      if (!paths?.length) return;
      if (paths.every(path => IMAGE.test(path))) {
        // An image is never opened as a text document.
        const active = activeTab();
        if (active?.lang === 'markdown' && active.filePath) void insertImages(active.filePath, paths, insertText);
        else setStatus(active?.lang === 'markdown' ? 'Save the document first: images are stored beside it.'
          : 'Images can be dropped into a saved Markdown document.', 'info');
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
