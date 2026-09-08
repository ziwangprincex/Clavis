import { dialogSave, fs, hasTauri } from '../api/tauri';
import { useTabsStore } from '../store/tabs';
import { setStatus, useStatusStore } from '../store/status';
import { detectDocumentLanguage, documentTitle } from './documentIdentity';
import { pathsEqual } from './projectPaths';
import { documentRoot } from '../compile/project';
import { documentOperation, markConflict, retainLocalCopy } from './documentSync';

export interface SaveOptions {
  saveAs?: boolean;
  automatic?: boolean;
  /** Explicitly reviewed disk version, never a blind force flag. */
  resolution?: { targetPath: string; revision: string; buffer: string; merged?: string };
}

export function saveTabToDisk(id: string, options: SaveOptions = {}): Promise<string | null> {
  return documentOperation(async () => {
    if (!hasTauri()) return null;
    const getTab = () => useTabsStore.getState().tabs.find(tab => tab.id === id);
    let tab = getTab();
    if (!tab || (options.automatic && (!tab.isDirty || !tab.filePath || tab.conflict || tab.diskError))) return null;
    const startingPath = tab.filePath;
    let target = options.resolution?.targetPath ?? tab.filePath;
    if (!target || options.saveAs) {
      const chosen = await dialogSave({
        defaultPath: target ?? undefined,
        filters: [{ name: 'Documents', extensions: ['md', 'qmd', 'tex', 'typ', 'bib', 'txt'] }],
      });
      if (typeof chosen !== 'string') return null;
      target = chosen;
    }
    tab = getTab();
    if (!tab || tab.filePath !== startingPath) return null;
    if (useTabsStore.getState().tabs.some(other => other.id !== id && other.filePath && pathsEqual(other.filePath, target))) {
      throw new Error('This file is already open in another tab. Save that tab instead.');
    }
    if (options.resolution && (tab.content !== options.resolution.buffer || tab.conflict?.targetPath !== target || tab.conflict.disk.revision !== options.resolution.revision)) {
      throw new Error('A version changed while reviewing. Reopen the comparison before saving.');
    }
    if (options.resolution && tab.conflict?.disk.content !== null && tab.conflict?.disk.content !== undefined) {
      retainLocalCopy({ ...tab, content: tab.conflict.disk.content }, 'disk copy');
    }
    let expected = options.resolution?.revision ?? (pathsEqual(target, tab.filePath) ? tab.diskRevision : undefined);
    if (expected === undefined) {
      const disk = await fs.readDocument(target);
      tab = getTab();
      if (!tab || tab.filePath !== startingPath) return null;
      // Legacy sessions have no baseline. Equal content is safe; any other
      // existing target requires review. Missing known paths require review too.
      if (disk.content === tab.content || (disk.content === null && !pathsEqual(target, tab.filePath))) {
        expected = disk.revision;
      } else {
        markConflict(id, target, disk);
        setStatus('Save paused: review the disk changes before saving', 'error');
        return null;
      }
    }
    const content = options.resolution?.merged ?? tab.content;
    const submitted = tab.content;
    const original = tab;
    const result = await fs.saveDocument(target, content, expected);
    const current = getTab();
    if (result.status === 'conflict') {
      if (current?.filePath === startingPath) markConflict(id, target, result.disk);
      setStatus('Save paused: the file changed on disk. Your writing is intact.', 'error');
      return null;
    }
    if (current && current.filePath === startingPath) {
      const unchanged = current.content === submitted;
      if (unchanged && content !== submitted) retainLocalCopy(original);
      useTabsStore.getState().patchTab(id, {
        filePath: target, title: documentTitle(target), lang: detectDocumentLanguage(target),
        // Save As copies this main document, not the project or its other tabs.
        ...(startingPath && !pathsEqual(startingPath, target) && pathsEqual(documentRoot(current), startingPath)
          ? { projectRoot: target } : {}),
        ...(unchanged ? { content } : {}),
        isDirty: !unchanged, diskRevision: result.revision, diskStamp: result.stamp,
        conflict: undefined, diskError: undefined,
      });
    }
    if (result.history_warning) setStatus(`Saved, but local history failed: ${result.history_warning}`, 'error');
    else if (/^Save (failed|paused):/.test(useStatusStore.getState().text)) setStatus('Ready');
    return target;
  }).catch(error => {
    setStatus(`Save failed: ${String(error)}`, 'error');
    throw error;
  });
}
