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
  /** What the last build ran, as Texifier's typeset bar shows it: engine, bibliography tool, passes. */
  chain: BuildChain | null;

  setStatus: (s: CompileStatus) => void;
  setErrors: (errors: LatexDiag[]) => void;
  appendLog: (line: LogLine) => void;
  clearLog: () => void;
  setLogTail: (tail: string) => void;
  setRuns: (n: number) => void;
}

export interface BuildChain { engine: string; bibTool: string | null; runs: number }

const ENGINE_NAMES: Record<string, string> = {
  pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX', latexmk: 'latexmk', bibtex: 'BibTeX', biber: 'Biber',
};
const programName = (name: string) => ENGINE_NAMES[name.toLowerCase()] ?? name;

/** `XeLaTeX · Biber · 3 passes`; latexmk counts its own passes, so none are listed. */
export function describeChain(chain: BuildChain, passes: (count: number) => string): string {
  const parts = [programName(chain.engine)];
  if (chain.bibTool) parts.push(programName(chain.bibTool));
  if (chain.engine !== 'latexmk' && chain.runs > 0) parts.push(passes(chain.runs));
  return parts.join(' · ');
}

const MAX_LOG_LINES = 5000;

/** LaTeX diagnostic kinds that stop a build; the log's other kinds are warnings. */
const ERROR_KINDS = new Set(['error', 'bib-error', 'missing-file']);
export const isLatexError = (kind: string) => ERROR_KINDS.has(kind);

/** The message to headline a failed build: its first error, not a warning listed before it. */
export function headlineProblem(errors: LatexDiag[]): string | undefined {
  return (errors.find(diag => isLatexError(diag.kind)) ?? errors[0])?.message;
}

export const useCompileStore = create<CompileStore>((set, get) => ({
  status: 'idle',
  errors: [],
  logLines: [],
  logTail: '',
  runs: 0,
  chain: null,

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
