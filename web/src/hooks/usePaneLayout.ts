// Owns the sidebar/editor pane widths: live drag state, initialization from
// persisted settings, and the drag handlers (which persist on drag end).
// Extracted verbatim from App.tsx.

import { useEffect, useRef, useState } from 'react';
import { useSettingsStore, type Settings } from '../store';

export interface PaneLayout {
  mainRef: React.RefObject<HTMLDivElement>;
  workAreaRef: React.RefObject<HTMLDivElement>;
  sidebarWidth: number;
  editorWidth: number;
  startSidebarDrag: () => void;
  dragSidebar: (clientX: number) => void;
  endSidebarDrag: () => void;
  startEditorDrag: () => void;
  dragEditor: (clientX: number) => void;
  endEditorDrag: () => void;
}

export function usePaneLayout(settings: Settings): PaneLayout {
  const mainRef = useRef<HTMLDivElement>(null);
  const workAreaRef = useRef<HTMLDivElement>(null);

  // Pane widths (live state). Persisted to settings on drag end. 0 = "use default".
  const [sidebarWidth, setSidebarWidth] = useState<number>(0);
  const [editorWidth, setEditorWidth] = useState<number>(0);

  // Initialise pane widths from persisted settings once they load.
  useEffect(() => {
    if (settings.pane_sidebar_width > 80) setSidebarWidth(settings.pane_sidebar_width);
    if (settings.pane_editor_width > 120) setEditorWidth(settings.pane_editor_width);
  }, [settings.pane_sidebar_width, settings.pane_editor_width]);

  function startSidebarDrag() {
    /* nothing — width state already current */
  }
  function dragSidebar(clientX: number) {
    const main = mainRef.current;
    if (!main) return;
    const left = main.getBoundingClientRect().left;
    const next = Math.max(160, Math.min(640, clientX - left));
    setSidebarWidth(next);
  }
  function endSidebarDrag() {
    void useSettingsStore.getState().patchAndSave({ pane_sidebar_width: sidebarWidth });
  }

  function startEditorDrag() {
    /* nothing */
  }
  function dragEditor(clientX: number) {
    const work = workAreaRef.current;
    if (!work) return;
    const left = work.getBoundingClientRect().left;
    const next = Math.max(200, Math.min(work.clientWidth - 200, clientX - left));
    setEditorWidth(next);
  }
  function endEditorDrag() {
    void useSettingsStore.getState().patchAndSave({ pane_editor_width: editorWidth });
  }

  return {
    mainRef,
    workAreaRef,
    sidebarWidth,
    editorWidth,
    startSidebarDrag,
    dragSidebar,
    endSidebarDrag,
    startEditorDrag,
    dragEditor,
    endEditorDrag,
  };
}
