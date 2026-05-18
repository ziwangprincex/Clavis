// Tabs store — represents an editor tab and its persistent state.
// Mirrors the legacy `tabs[]` + `activeTabId` globals (ui-legacy/app.js).

import { create } from 'zustand';

export type Lang = 'markdown' | 'latex' | 'typst';

export interface Tab {
  id: string;
  title: string;
  /** absolute file path on disk; null for unsaved scratch tabs */
  filePath: string | null;
  lang: Lang;
  content: string;
  isDirty: boolean;
  /** LaTeX project root (active tex file) — only relevant for lang='latex' */
  projectRoot?: string | null;
  projectActive?: string | null;
  latexWorkdirToken?: string | null;
}

interface TabsStore {
  tabs: Tab[];
  activeTabId: string | null;
  setTabs: (tabs: Tab[]) => void;
  setActive: (id: string | null) => void;
  patchTab: (id: string, delta: Partial<Tab>) => void;
  addTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
}

let nextTabSeq = 1;
export function newTabId(): string {
  return `t${Date.now()}-${nextTabSeq++}`;
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  setTabs(tabs) {
    set({ tabs });
  },
  setActive(id) {
    set({ activeTabId: id });
  },
  patchTab(id, delta) {
    set({
      tabs: get().tabs.map(t => (t.id === id ? { ...t, ...delta } : t)),
    });
  },
  addTab(tab) {
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id });
  },
  closeTab(id) {
    const closing = get().tabs.find(t => t.id === id);
    const remaining = get().tabs.filter(t => t.id !== id);
    const wasActive = get().activeTabId === id;
    set({
      tabs: remaining,
      activeTabId: wasActive ? remaining.at(-1)?.id ?? null : get().activeTabId,
    });
    // Best-effort: drop the LaTeX workdir on disk so we don't leak temp files
    // across long sessions. Done via dynamic import to keep this store free
    // of Tauri runtime dependencies (it's also used in browser preview mode).
    if (closing?.latexWorkdirToken) {
      const token = closing.latexWorkdirToken;
      void import('../api/tauri').then(({ ipc, hasTauri }) => {
        if (hasTauri()) ipc.cleanupWorkdir(token).catch(() => {});
      });
    }
  },
}));
