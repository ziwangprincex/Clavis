import { create } from 'zustand';
import { ipc, type GitCommit, type GitWorkspaceStatus } from '../api/tauri';

interface GitStore {
  status: GitWorkspaceStatus | null;
  history: GitCommit[];
  diff: string;
  selectedPath: string | null;
  loading: boolean;
  error: string | null;
  generation: number;
  refresh: (root: string) => Promise<void>;
  selectFile: (root: string, path: string | null) => Promise<void>;
  clear: () => void;
}

export const useGitStore = create<GitStore>((set, get) => ({
  status: null, history: [], diff: '', selectedPath: null, loading: false, error: null, generation: 0,
  async refresh(root) {
    const generation = get().generation + 1;
    set({ generation, loading: true, error: null });
    try {
      const status = await ipc.inspectGitWorkspace(root);
      const history = status.isRepository ? await ipc.gitHistory(root) : [];
      if (get().generation === generation) set({ status, history, loading: false });
    } catch (error) {
      if (get().generation === generation) set({ status: null, history: [], loading: false, error: String(error) });
    }
  },
  async selectFile(root, path) {
    set({ selectedPath: path, diff: '' });
    if (!path) return;
    try { set({ diff: await ipc.gitFileDiff(root, path) }); }
    catch (error) { set({ error: String(error) }); }
  },
  clear() { set(state => ({ status: null, history: [], diff: '', selectedPath: null, loading: false, error: null, generation: state.generation + 1 })); },
}));
