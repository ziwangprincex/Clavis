import { create } from 'zustand';
import { ipc, type AssetIndexResult } from '../api/tauri';
import type { Tab } from './tabs';

interface AssetsStore {
  result: AssetIndexResult | null;
  loading: boolean;
  error: string | null;
  generation: number;
  refresh: (root: string, tabs: Tab[]) => Promise<void>;
  clear: () => void;
}

export const useAssetsStore = create<AssetsStore>((set, get) => ({
  result: null, loading: false, error: null, generation: 0,
  async refresh(root, tabs) {
    const generation = get().generation + 1;
    set({ generation, loading: true, error: null });
    try {
      const result = await ipc.indexAssets({ root, documents: tabs.filter(tab => tab.filePath).map(tab => ({ path: tab.filePath!, language: tab.lang, text: tab.content })) });
      if (get().generation === generation) set({ result, loading: false });
    } catch (error) {
      if (get().generation === generation) set({ result: null, loading: false, error: String(error) });
    }
  },
  clear() { set(state => ({ result: null, loading: false, error: null, generation: state.generation + 1 })); },
}));
