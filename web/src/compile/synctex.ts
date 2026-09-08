import { ipc } from '../api/tauri';
import { useTabsStore, usePdfStore } from '../store';
import { pathsEqual, resolveSyncTexFile } from '../files/projectPaths';
import { belongsToPdf } from './target';

export async function syncTexForwardFromEditor(line: number) {
  const state = useTabsStore.getState();
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  const pdf = usePdfStore.getState();
  if (!tab || !pdf.workdirToken || !belongsToPdf(tab, pdf)) return null;
  const file = pdf.sourceFiles.find(f => pathsEqual(f.absPath, tab.filePath));
  const inputFile = !pdf.sourceRoot || pathsEqual(pdf.sourceRoot, tab.filePath) ? 'main.tex' : file?.relPath;
  if (!inputFile) return null;
  try {
    const result = await ipc.synctexForward(pdf.workdirToken, line, 0, inputFile);
    if (result?.page) usePdfStore.getState().requestScroll(result.page, result.y ?? null);
    return result;
  } catch (error) {
    console.error('synctex forward failed', error);
    return null;
  }
}

export async function syncTexBackwardFromPdf(
  page: number,
  x: number,
  y: number,
  openAndScroll: (absPath: string | null, line: number) => void,
): Promise<void> {
  const pdf = usePdfStore.getState();
  if (!pdf.workdirToken) return;
  try {
    const result = await ipc.synctexBackward(pdf.workdirToken, page, x, y);
    if (!result?.line) return;
    const path = resolveSyncTexFile(result.inputFile, pdf.sourceFiles, pdf.sourceRoot);
    if (pdf.sourceRoot && !path) return;
    openAndScroll(path, result.line);
  } catch (error) {
    console.error('synctex backward failed', error);
  }
}
