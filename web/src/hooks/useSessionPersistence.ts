// Wires up session persistence (crash-recovery) and the opt-in disk-autosave
// interval. Extracted verbatim from App.tsx.
//
// - Debounced session save on every tabs-store change, plus a flush on unload.
// - Autosave interval started/stopped when the setting toggles.
//
// Session *restore* on boot stays in App.tsx's boot effect: it's interleaved
// with settings-load and sample-tab seeding, which are App concerns.

import { useEffect } from 'react';
import { hasTauri } from '../api/tauri';
import { useTabsStore, useProjectStore } from '../store';
import { scheduleSessionSave, flushSessionSave, syncAutosaveInterval } from '../files/session';

export function useSessionPersistence(autosaveEnabled: boolean, ready = true): void {
  // Persist the session (debounced) whenever tabs change, and flush on unload
  // so an OS-level close doesn't lose the last few edits.
  useEffect(() => {
    if (!hasTauri() || !ready) return;
    scheduleSessionSave();
    const unsub = useTabsStore.subscribe(() => scheduleSessionSave());
    const unsubFolder = useProjectStore.subscribe((state, previous) => {
      if (state.folderPath !== previous.folderPath) scheduleSessionSave();
    });
    const onBeforeUnload = () => flushSessionSave();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      unsub();
      unsubFolder();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [ready]);

  // Start/stop the disk-autosave interval when the setting changes.
  useEffect(() => {
    syncAutosaveInterval();
  }, [autosaveEnabled]);
}
