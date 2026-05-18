// Compile store — LaTeX/Typst compilation state and diagnostics.
// Mirrors legacy `compile_latex` callback handling + `showErrors` rendering.

import { create } from 'zustand';
import type { LatexDiag } from '../api/tauri';

export interface LogLine {
  run: number;
  stream: 'stdout' | 'stderr' | 'info';
  text: string;
}

export type CompileStatus = 'idle' | 'compiling' | 'ok' | 'error';

interface CompileStore {
  status: CompileStatus;
  errors: LatexDiag[];
  logLines: LogLine[];
  /** "summary log tail" returned at end of compile */
  logTail: string;
  /** compile run counter (just for display, e.g. "Rendered (3 runs)") */
  runs: number;

  setStatus: (s: CompileStatus) => void;
  setErrors: (errors: LatexDiag[]) => void;
  appendLog: (line: LogLine) => void;
  clearLog: () => void;
  setLogTail: (tail: string) => void;
  setRuns: (n: number) => void;
}

const MAX_LOG_LINES = 5000;

export const useCompileStore = create<CompileStore>((set, get) => ({
  status: 'idle',
  errors: [],
  logLines: [],
  logTail: '',
  runs: 0,

  setStatus(s) {
    set({ status: s });
  },
  setErrors(errors) {
    set({ errors });
  },
  appendLog(line) {
    const lines = get().logLines;
    const next = lines.length >= MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES + 1) : lines;
    set({ logLines: [...next, line] });
  },
  clearLog() {
    set({ logLines: [], logTail: '', errors: [] });
  },
  setLogTail(tail) {
    set({ logTail: tail });
  },
  setRuns(n) {
    set({ runs: n });
  },
}));
