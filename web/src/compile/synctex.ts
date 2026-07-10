// SyncTeX glue — forward (editor → PDF) and backward (PDF → editor) lookups
// against the active workdir token.

import { ipc } from '../api/tauri';
import { useTabsStore, usePdfStore, useProjectStore } from '../store';
import { resolveSyncTexFile } from '../files/projectPaths';

export async function syncTexForwardFromEditor(line: number) {
  const state = useTabsStore.getState();
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (!tab?.latexWorkdirToken) return null;
  try {
    const r = await ipc.synctexForward(tab.latexWorkdirToken, line, 0);
    if (r?.page) usePdfStore.getState().requestScroll(r.page, r.y ?? null);
    return r;
  } catch (e) {
    console.error('synctex forward failed', e);
    return null;
  }
}

export async function syncTexBackwardFromPdf(
  page: number,
  x: number,
  y: number,
  /**
   * Open the target file (if it differs from the active editor) and scroll to
   * `line`. `absPath` is null when SyncTeX pointed at the project root / main.tex
   * or no project is active — the caller then just scrolls the active editor.
   */
  openAndScroll: (absPath: string | null, line: number) => void,
): Promise<void> {
  const token = usePdfStore.getState().workdirToken;
  if (!token) return;
  try {
    const r = await ipc.synctexBackward(token, page, x, y);
    if (!r?.line) return;
    const project = useProjectStore.getState();
    const absPath = resolveSyncTexFile(r.inputFile, project.files, project.rootAbs);
    openAndScroll(absPath, r.line);
  } catch (e) {
    console.error('synctex backward failed', e);
  }
}
