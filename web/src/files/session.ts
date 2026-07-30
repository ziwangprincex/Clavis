// Session persistence + autosave.
//
// Two related but distinct features:
//
//  1. Session restore (crash recovery) — always on. The Workspace is persisted
//     as a validated Session Snapshot. This never writes to the user's files.
//
//  2. Autosave to disk — opt-in (settings.autosave_enabled). Periodically
//     writes dirty, file-backed Documents. Scratch Documents are covered by the
//     Session Snapshot instead.

import { ipc, hasTauri } from '../api/tauri';
import { useTabsStore, newTabId } from '../store';
import { useSettingsStore } from '../store';
import { decodeSessionSnapshot, encodeSessionSnapshot } from './sessionModel';

const SESSION_DEBOUNCE_MS = 800;
const AUTOSAVE_INTERVAL_MS = 30_000;

function snapshot(): string {
  const { tabs, activeTabId } = useTabsStore.getState();
  return encodeSessionSnapshot(tabs, activeTabId);
}

/** Restore a previous Session Snapshot. Returns true when Documents survived validation. */
export async function restoreSession(): Promise<boolean> {
  if (!hasTauri()) return false;

  let restored;
  try {
    const raw = await ipc.loadSession();
    if (!raw) return false;
    restored = decodeSessionSnapshot(raw);
  } catch {
    return false;
  }
  if (!restored) return false;

  const tabs = restored.tabs.map(tab => ({ ...tab, id: newTabId() }));
  const activeTabId = tabs[restored.activeIndex]?.id ?? tabs[0]?.id ?? null;
  useTabsStore.setState({ tabs, activeTabId });
  return tabs.length > 0;
}

let sessionTimer: ReturnType<typeof setTimeout> | null = null;

/** Persist the Session Snapshot, debounced. Safe to call on every keystroke. */
export function scheduleSessionSave(): void {
  if (!hasTauri()) return;
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    sessionTimer = null;
    void ipc.saveSession(snapshot()).catch(() => {});
  }, SESSION_DEBOUNCE_MS);
}

/** Persist the Session Snapshot immediately (for example, on window close). */
export function flushSessionSave(): void {
  if (!hasTauri()) return;
  if (sessionTimer) {
    clearTimeout(sessionTimer);
    sessionTimer = null;
  }
  void ipc.saveSession(snapshot()).catch(() => {});
}

/** Write all dirty, file-backed Documents to disk. Scratch Documents are skipped. */
async function autosaveDirtyTabs(): Promise<void> {
  if (!hasTauri()) return;
  const { fs } = await import('../api/tauri');
  const store = useTabsStore.getState();
  for (const tab of store.tabs) {
    if (!tab.isDirty || !tab.filePath) continue;
    try {
      await fs.writeTextFile(tab.filePath, tab.content);
      store.patchTab(tab.id, { isDirty: false });
    } catch {
      // Leave dirty; the user can still save manually.
    }
  }
}

let autosaveTimer: ReturnType<typeof setInterval> | null = null;

/** Start or stop disk autosave based on the current setting. */
export function syncAutosaveInterval(): void {
  const enabled = useSettingsStore.getState().settings.autosave_enabled === true;
  if (enabled && !autosaveTimer) {
    autosaveTimer = setInterval(() => void autosaveDirtyTabs(), AUTOSAVE_INTERVAL_MS);
  } else if (!enabled && autosaveTimer) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
}
