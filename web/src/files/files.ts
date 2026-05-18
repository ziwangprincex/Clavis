// File operations — open / save tabs via Tauri dialog + fs APIs.

import { dialogOpen, dialogSave, fs, hasTauri, ipc } from '../api/tauri';
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

export async function openFileDialog(): Promise<void> {
  if (!hasTauri()) return;
  try {
    const path = await dialogOpen({ multiple: false, filters: FILE_FILTERS });
    if (typeof path === 'string') await openFileByPath(path);
  } catch (e) {
    console.error('open file failed', e);
  }
}

export async function openFileByPath(path: string): Promise<void> {
  if (!hasTauri()) return;
  // Reuse an existing tab opened on the same path if any.
  const existing = useTabsStore.getState().tabs.find(t => t.filePath === path);
  if (existing) {
    useTabsStore.getState().setActive(existing.id);
    return;
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
        type ProjFile = {
          relPath: string;
          absPath: string;
          content: string;
          binaryBase64?: string | null;
          isBib?: boolean;
        };
        useProjectStore.setState({
          rootAbs: path,
          rootBasename: filename(path),
          activeAbs: path,
          files: ((r.files ?? []) as ProjFile[]),
          warnings: r.warnings ?? [],
        });
      } catch (e) {
        // Non-fatal — user can still edit; the sidebar just stays empty.
        console.warn('collect_project_files failed', e);
      }
    }
  } catch (e) {
    console.error('read file failed', path, e);
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
