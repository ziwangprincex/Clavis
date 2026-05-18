// SyncTeX glue — forward (editor → PDF) and backward (PDF → editor) lookups
// against the active workdir token.

import { ipc } from '../api/tauri';
import { useTabsStore, usePdfStore } from '../store';

export interface SyncTexForwardResult {
  page?: number;
  x?: number;
  y?: number;
}

export interface SyncTexBackwardResult {
  file?: string;
  line?: number;
}

export async function syncTexForwardFromEditor(line: number): Promise<SyncTexForwardResult | null> {
  const state = useTabsStore.getState();
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (!tab?.latexWorkdirToken) return null;
  try {
    const r = (await ipc.synctexForward(tab.latexWorkdirToken, line, 0)) as SyncTexForwardResult;
    if (r?.page) usePdfStore.getState().setCurrentPage(r.page);
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
  jumpToLine: (line: number) => void,
): Promise<void> {
  const token = usePdfStore.getState().workdirToken;
  if (!token) return;
  try {
    const r = (await ipc.synctexBackward(token, page, x, y)) as SyncTexBackwardResult;
    if (r?.line) jumpToLine(r.line);
  } catch (e) {
    console.error('synctex backward failed', e);
  }
}
