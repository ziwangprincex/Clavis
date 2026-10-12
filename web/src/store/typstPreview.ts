import { create } from 'zustand';
import type { TypstDiagnostic } from '../api/tauri';

export const useTypstPreviewStore = create<{
  jump: { file: string | null; line: number; seq: number } | null;
  requestJump: (file: string | null, line: number) => void;
  /** The latest preview's messages, for the editor margin. */
  diagnostics: TypstDiagnostic[];
}>(set => ({
  jump: null,
  requestJump: (file, line) => set(s => ({ jump: { file, line, seq: (s.jump?.seq ?? 0) + 1 } })),
  diagnostics: [],
}));
