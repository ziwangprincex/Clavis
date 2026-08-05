import { create } from 'zustand';
import { ipc, type ArtifactStatus } from '../api/tauri';

interface ArtifactsStore {
  items: ArtifactStatus[];
  loading: boolean;
  error: string | null;
  generation: number;
  refresh: (root: string) => Promise<void>;
  clear: () => void;
}

export const useArtifactsStore = create<ArtifactsStore>((set, get) => ({
  items: [], loading: false, error: null, generation: 0,
  async refresh(root) {
    const generation = get().generation + 1;
    set({ generation, loading: true, error: null });
    try {
      const items = await ipc.inspectArtifacts(root);
      if (get().generation === generation) set({ items, loading: false });
    } catch (error) {
      if (get().generation === generation) set({ items: [], loading: false, error: String(error) });
    }
  },
  clear() {
    set(state => ({ items: [], loading: false, error: null, generation: state.generation + 1 }));
  },
}));
