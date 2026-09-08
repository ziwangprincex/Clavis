import { create } from 'zustand';
export const useTypstPreviewStore = create<{
  jump: { file: string | null; line: number; seq: number } | null;
  requestJump: (file: string | null, line: number) => void;
}>(set => ({ jump: null, requestJump: (file, line) => set(s => ({ jump: { file, line, seq: (s.jump?.seq ?? 0) + 1 } })) }));
