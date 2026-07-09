// Session persistence + autosave.
//
// Two related but distinct features:
//
//  1. Session restore (crash recovery) — always on. The set of open tabs and
//     their *in-memory* content is persisted to an opaque blob (session.json,
//     owned by Rust only as bytes). On launch we restore it, so an unexpected
//     quit / crash never loses unsaved scratch buffers. This never writes to
//     the user's own files.
//
//  2. Autosave to disk — opt-in (settings.autosave_enabled). Periodically
//     writes *dirty, file-backed* tabs back to their path on disk. Scratch
//     tabs (no filePath) are never touched — they're covered by (1) instead.

import { ipc, hasTauri } from '../api/tauri';
import { useTabsStore, type Tab } from '../store';
import { useSettingsStore } from '../store';

const SESSION_VERSION = 1;
const SESSION_DEBOUNCE_MS = 800;
const AUTOSAVE_INTERVAL_MS = 30_000;

interface PersistedTab {
  title: string;
  filePath: string | null;
  lang: Tab['lang'];
  content: string;
  isDirty: boolean;
}

interface PersistedSession {
  version: number;
  activeIndex: number;
  tabs: PersistedTab[];
}

function snapshot(): PersistedSession {
  const { tabs, activeTabId } = useTabsStore.getState();
  return {
    version: SESSION_VERSION,
    activeIndex: Math.max(0, tabs.findIndex(t => t.id === activeTabId)),
    tabs: tabs.map(t => ({
      title: t.title,
      filePath: t.filePath,
      lang: t.lang,
      content: t.content,
      isDirty: t.isDirty,
    })),
  };
}

/** Restore a previous session. Returns true if any tabs were restored. */
export async function restoreSession(): Promise<boolean> {
  if (!hasTauri()) return false;
  let parsed: PersistedSession | null = null;
  try {
    const raw = await ipc.loadSession();
    if (!raw) return false;
    parsed = JSON.parse(raw) as PersistedSession;
  } catch {
    return false; // corrupt / unreadable → fall back to sample tabs
  }
  if (!parsed || parsed.version !== SESSION_VERSION || !parsed.tabs?.length) {
    return false;
  }
  const store = useTabsStore.getState();
  const { newTabId } = await import('../store');
  const ids: string[] = [];
  for (const pt of parsed.tabs) {
    const id = newTabId();
    ids.push(id);
    store.addTab({
      id,
      title: pt.title,
      filePath: pt.filePath,
      lang: pt.lang,
      content: pt.content,
      isDirty: pt.isDirty,
    });
  }
  const activeId = ids[Math.min(parsed.activeIndex, ids.length - 1)];
  if (activeId) store.setActive(activeId);
  return true;
}

let sessionTimer: ReturnType<typeof setTimeout> | null = null;

/** Persist the session, debounced. Safe to call on every keystroke. */
export function scheduleSessionSave(): void {
  if (!hasTauri()) return;
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    sessionTimer = null;
    void ipc.saveSession(JSON.stringify(snapshot())).catch(() => {});
  }, SESSION_DEBOUNCE_MS);
}

/** Persist the session immediately (e.g. on window close). */
export function flushSessionSave(): void {
  if (!hasTauri()) return;
  if (sessionTimer) {
    clearTimeout(sessionTimer);
    sessionTimer = null;
  }
  void ipc.saveSession(JSON.stringify(snapshot())).catch(() => {});
}

/** Write all dirty, file-backed tabs to disk. Scratch tabs are skipped. */
async function autosaveDirtyTabs(): Promise<void> {
  if (!hasTauri()) return;
  const { fs } = await import('../api/tauri');
  const store = useTabsStore.getState();
  for (const t of store.tabs) {
    if (!t.isDirty || !t.filePath) continue;
    try {
      await fs.writeTextFile(t.filePath, t.content);
      store.patchTab(t.id, { isDirty: false });
    } catch {
      // Leave dirty; the user can still save manually.
    }
  }
}

let autosaveTimer: ReturnType<typeof setInterval> | null = null;

/** Start/stop the disk-autosave interval based on the current setting. */
export function syncAutosaveInterval(): void {
  const enabled = useSettingsStore.getState().settings.autosave_enabled === true;
  if (enabled && !autosaveTimer) {
    autosaveTimer = setInterval(() => void autosaveDirtyTabs(), AUTOSAVE_INTERVAL_MS);
  } else if (!enabled && autosaveTimer) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
}
