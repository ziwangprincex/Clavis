import { create } from 'zustand';
import type { Tab } from './tabs';
import { analyzeOpenDocuments, type WritingDiagnostic, type WritingOptions } from '../writing/rules';

const MAX_DIAGNOSTICS = 500;

interface WritingStore {
  diagnostics: WritingDiagnostic[];
  refreshedAt: number;
  refresh: (tabs: readonly Tab[], options?: WritingOptions) => void;
  clear: () => void;
}

export const useWritingStore = create<WritingStore>(set => ({
  diagnostics: [],
  refreshedAt: 0,
  refresh(tabs, options) {
    const diagnostics = analyzeOpenDocuments(tabs, options).slice(0, MAX_DIAGNOSTICS);
    set({ diagnostics, refreshedAt: Date.now() });
  },
  clear() { set({ diagnostics: [], refreshedAt: Date.now() }); },
}));
