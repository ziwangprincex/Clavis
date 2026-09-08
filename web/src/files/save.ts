import { dialogSave, fs, hasTauri } from '../api/tauri';
import { useTabsStore } from '../store/tabs';
import { setStatus, useStatusStore } from '../store/status';
import { detectDocumentLanguage, documentTitle } from './documentIdentity';
import { pathsEqual } from './projectPaths';

// Manual save, Save As and autosave share one queue. Snapshot at execution time,
// not enqueue time, so an older queued write cannot overwrite a newer buffer.
let pending: Promise<void> = Promise.resolve();

export interface SaveOptions {
  saveAs?: boolean;
  automatic?: boolean;
}

export function saveTabToDisk(id: string, options: SaveOptions = {}): Promise<string | null> {
  const operation = pending.then(async () => {
    if (!hasTauri()) return null;
    const getTab = () => useTabsStore.getState().tabs.find(tab => tab.id === id);
    let tab = getTab();
    if (!tab || (options.automatic && (!tab.isDirty || !tab.filePath))) return null;
    let target = tab.filePath;
    if (!target || options.saveAs) {
      const chosen = await dialogSave({
        defaultPath: target ?? undefined,
        filters: [{ name: 'Documents', extensions: ['md', 'qmd', 'tex', 'typ', 'bib', 'txt'] }],
      });
      if (typeof chosen !== 'string') return null;
      target = chosen;
    }
    // A save dialog can stay open while the buffer changes or the tab closes.
    tab = getTab();
    if (!tab) return null;
    if (useTabsStore.getState().tabs.some(other => other.id !== id && other.filePath && pathsEqual(other.filePath, target))) {
      throw new Error('This file is already open in another tab. Save that tab instead.');
    }
    const content = tab.content;
    const originalPath = tab.filePath;
    await fs.writeTextFile(target, content);
    const current = getTab();
    if (current && current.filePath === originalPath) {
      useTabsStore.getState().patchTab(id, {
        filePath: target,
        title: documentTitle(target),
        lang: detectDocumentLanguage(target),
        isDirty: current.content !== content,
      });
    }
    if (useStatusStore.getState().text.startsWith('Save failed:')) setStatus('Ready');
    return target;
  });
  // A failed write must not poison the queue or mark any buffer as saved.
  pending = operation.then(() => {}, () => {});
  return operation.catch(error => {
    setStatus(`Save failed: ${String(error)}`, 'error');
    throw error;
  });
}
