// File operations — open / save tabs via Tauri dialog + fs APIs.

import { dialogOpen, dialogSave, fs, hasTauri, ipc } from '../api/tauri';
import { pathsEqual } from './projectPaths';
import {
  useTabsStore,
  useSettingsStore,
  useProjectStore,
  newTabId,
  type Lang,
} from '../store';

const FILE_FILTERS: { name: string; extensions: string[] }[] = [
  { name: 'Documents', extensions: ['md', 'tex', 'typ', 'bib', 'txt'] },
  { name: 'All Files', extensions: ['*'] },
];

const RECENT_LIMIT = 10;

function detectLang(path: string): Lang {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tex') || lower.endsWith('.ltx')) return 'latex';
  if (lower.endsWith('.typ')) return 'typst';
  return 'markdown';
}

function filename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Push `path` to the head of recent_files (deduped, capped). Persists. */
async function pushRecent(path: string): Promise<void> {
  const settingsStore = useSettingsStore.getState();
  const current = settingsStore.settings.recent_files ?? [];
  const next = [path, ...current.filter(p => p !== path)].slice(0, RECENT_LIMIT);
  await settingsStore.patchAndSave({ recent_files: next });
}

/** Push a workspace folder to the head of recent_folders (deduped, capped). */
export async function pushRecentFolder(path: string): Promise<void> {
  const settingsStore = useSettingsStore.getState();
  const current = settingsStore.settings.recent_folders ?? [];
  const next = [path, ...current.filter(p => p !== path)].slice(0, RECENT_LIMIT);
  await settingsStore.patchAndSave({ recent_folders: next });
}

export async function openFileDialog(): Promise<void> {
  if (!hasTauri()) return;
  try {
    const path = await dialogOpen({ multiple: false, filters: FILE_FILTERS });
    if (typeof path === 'string') await openFileByPath(path);
  } catch (e) {
    console.error('open file failed', e);
  }
}

/** Open `path` in a tab (reusing an existing one) and make it active. Returns
 *  true if a tab is now active on that path, false if the open failed/no-op. */
export async function openFileByPath(path: string): Promise<boolean> {
  if (!hasTauri()) return false;
  // Reuse an existing tab opened on the same path if any (normalization-aware:
  // dialog paths are plain while project/synctex paths may be \\?\ canonical).
  const existing = useTabsStore.getState().tabs.find(t => pathsEqual(t.filePath, path));
  if (existing) {
    useTabsStore.getState().setActive(existing.id);
    return true;
  }
  try {
    const content = await fs.readTextFile(path);
    const detectedLang = detectLang(path);
    useTabsStore.getState().addTab({
      id: newTabId(),
      title: filename(path),
      filePath: path,
      lang: detectedLang,
      content,
      isDirty: false,
    });
    void pushRecent(path);

    // If we just opened a .tex file and no LaTeX project is currently active,
    // probe the project structure (so the sidebar's "Project files" and
    // "Bibliography" sections become useful right away).
    if (detectedLang === 'latex' && !useProjectStore.getState().rootAbs) {
      try {
        const r = await ipc.collectProjectFiles(path);
        useProjectStore.setState({
          rootAbs: path,
          rootBasename: filename(path),
          activeAbs: path,
          files: r.files ?? [],
          warnings: r.warnings ?? [],
        });
      } catch (e) {
        // Non-fatal — user can still edit; the sidebar just stays empty.
        console.warn('collect_project_files failed', e);
      }
    }
    return true;
  } catch (e) {
    console.error('read file failed', path, e);
    return false;
  }
}

export async function saveActiveTab(opts: { saveAs?: boolean } = {}): Promise<void> {
  if (!hasTauri()) return;
  const state = useTabsStore.getState();
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (!tab) return;
  let target = tab.filePath;
  if (!target || opts.saveAs) {
    try {
      const chosen = await dialogSave({
        defaultPath: target ?? undefined,
        filters: FILE_FILTERS,
      });
      if (typeof chosen !== 'string') return;
      target = chosen;
    } catch (e) {
      console.error('save dialog failed', e);
      return;
    }
  }
  try {
    await fs.writeTextFile(target, tab.content);
    state.patchTab(tab.id, {
      filePath: target,
      title: filename(target),
      lang: detectLang(target),
      isDirty: false,
    });
    void pushRecent(target);
  } catch (e) {
    console.error('write file failed', target, e);
  }
}

/**
 * Open `absPath` (reusing an existing tab or creating one) and scroll its editor
 * to `line`. When `absPath` is null or already the active tab, just scroll the
 * current editor. Used by SyncTeX-reverse, the merged outline, bib jumps, and
 * clickable \input — all of which may target a file other than the active one.
 *
 * The scroll is deferred a frame: switching the active tab makes EditorPane swap
 * its content on the next React commit, so scrolling must happen after that.
 */
export async function openFileAndScrollToLine(
  absPath: string | null,
  line: number,
  scrollActive: (line: number) => void,
): Promise<void> {
  const state = useTabsStore.getState();
  const active = state.tabs.find(t => t.id === state.activeTabId);
  // Normalization-aware compare so a \\?\ canonical path vs a plain dialog path
  // for the *same* active file doesn't trigger a needless (duplicate) open.
  const needsOpen = absPath != null && !pathsEqual(active?.filePath, absPath);
  if (needsOpen) {
    const opened = await openFileByPath(absPath!);
    // Only scroll after a successful open/switch; otherwise the active tab
    // didn't change and scrolling it would jump the wrong file to `line`.
    if (opened) {
      // Let EditorPane's tab-switch effect push the new content before scrolling.
      requestAnimationFrame(() => requestAnimationFrame(() => scrollActive(line)));
    }
  } else {
    scrollActive(line);
  }
}