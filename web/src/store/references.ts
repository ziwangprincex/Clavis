import { create } from 'zustand';
import { ipc, type ReferenceIndexResult } from '../api/tauri';
import type { Tab } from './tabs';

interface ReferencesStore {
  result: ReferenceIndexResult | null;
  loading: boolean;
  error: string | null;
  generation: number;
  refresh: (root: string, tabs: Tab[]) => Promise<void>;
  clear: () => void;
}

export const useReferencesStore = create<ReferencesStore>((set, get) => ({
  result: null,
  loading: false,
  error: null,
  generation: 0,

  async refresh(root, tabs) {
    const generation = get().generation + 1;
    set({ generation, loading: true, error: null });
    try {
      const result = await ipc.indexReferences({
        root,
        documents: tabs
          .filter(tab => tab.filePath)
          .map(tab => ({ path: tab.filePath!, language: tab.lang, text: tab.content, isDirty: tab.isDirty })),
      });
      if (get().generation === generation) set({ result, loading: false });
    } catch (error) {
      if (get().generation === generation) {
        set({ error: String(error), loading: false, result: null });
      }
    }
  },

  clear() {
    set(state => ({ result: null, loading: false, error: null, generation: state.generation + 1 }));
  },
}));
