// Status store — the transient user-facing message shown in the status bar
// ("Compiling…", "PDF exported", "Compile failed (3 issues)", …).
//
// Previously lived as local `statusText`/`statusKind` state in App.tsx and was
// piped down to Toolbar. The status bar (StatusBar.tsx) is not a direct child
// of App.tsx anymore, and the same message is written from ~10 async helpers
// (compileNow, exportLatexPdf, exportTypstPdf, setProjectMain, installPackage).
// A tiny global store beats prop-drilling in this shape.

import { create } from 'zustand';

export type StatusKind = 'info' | 'ok' | 'error';

interface StatusStore {
  text: string;
  kind: StatusKind;
  set: (text: string, kind?: StatusKind) => void;
}

export const useStatusStore = create<StatusStore>(set => ({
  text: 'Ready',
  kind: 'info',
  set: (text, kind = 'info') => set({ text, kind }),
}));

/** Non-hook accessor for use inside async helpers outside React. */
export function setStatus(text: string, kind: StatusKind = 'info'): void {
  useStatusStore.getState().set(text, kind);
}

// Cursor position, updated live from the editor's onCursor callback. Kept in
// the same store because the status bar consumes both, but not exported through
// the same helper since only EditorPane writes it.

interface CursorStore {
  line: number;
  column: number;
  selectionFrom: number;
  selectionTo: number;
  setPos: (line: number, column: number, selectionFrom?: number, selectionTo?: number) => void;
}

export const useCursorStore = create<CursorStore>(set => ({
  line: 1,
  column: 1,
  selectionFrom: 0,
  selectionTo: 0,
  setPos: (line, column, selectionFrom = 0, selectionTo = selectionFrom) => set({ line, column, selectionFrom, selectionTo }),
}));
