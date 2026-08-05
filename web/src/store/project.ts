// Project store — multi-file LaTeX project state.
// Mirrors the legacy `currentProject` global (ui-legacy/app.js).

import { create } from 'zustand';
import type { WorkspaceInspection } from '../api/tauri';

export interface ProjectFile {
  /** relative path inside the project (with forward slashes) */
  relPath: string;
  absPath: string;
  /** text content for editable files; null for binary */
  content: string;
  /** base64 of binary content if applicable */
  binaryBase64?: string | null;
  /** convenience flag set by collect_project_files */
  isBib?: boolean;
}

interface ProjectStore {
  workspace: WorkspaceInspection | null;
  rootAbs: string | null;
  rootBasename: string | null;
  /** path of the file currently being edited within the project */
  activeAbs: string | null;
  files: ProjectFile[];
  warnings: string[];
  setProject: (p: Partial<Omit<ProjectStore, 'setProject' | 'reset'>>) => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectStore>(set => ({
  workspace: null,
  rootAbs: null,
  rootBasename: null,
  activeAbs: null,
  files: [],
  warnings: [],
  setProject(p) {
    set(state => ({ ...state, ...p }));
  },
  reset() {
    set({
      workspace: null,
      rootAbs: null,
      rootBasename: null,
      activeAbs: null,
      files: [],
      warnings: [],
    });
  },
}));
