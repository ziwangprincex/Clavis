// Owns the sidebar/editor pane sizes: live drag state, initialization from
// persisted settings, and the drag handlers (which persist on drag end).
//
// The editor/preview split is stored as a RATIO (0..1), not a pixel width, so
// resizing the window keeps rebalancing the two panes. Pinning the editor to an
// absolute `flex: 0 0 Npx` froze the split: the editor stayed at N px forever
// and the preview absorbed every window-size change.
//
// Two subtleties, each of which caused a real "the splitter snaps back / sticks
// to one position" bug:
//
// 1. STALE DRAG CLOSURES. `Splitter` installs its mousemove/mouseup listeners
//    once per mousedown, inside a `useCallback` closing over the handlers it had
//    at that instant. So `end*Drag` must NOT read React state — that closure is
//    stale and would persist the value from BEFORE the drag. Live values are
//    mirrored into refs, and the `end*Drag` handlers read the refs.
//
// 2. SEED-EFFECT FEEDBACK LOOP. The init effect depends on the persisted
//    settings. `patchAndSave` on drag end changes those settings, which re-runs
//    the effect, which calls `set*` with the just-saved (or, thanks to #1,
//    pre-drag) value — visibly yanking the splitter back. It now seeds only
//    once, on first load, and never fights the user afterwards.

import { useEffect, useRef, useState } from 'react';
import { useSettingsStore, type Settings } from '../store';

/** Smallest usable width for the editor or the preview pane, in px. */
const MIN_PANE_PX = 220;

export interface PaneLayout {
  mainRef: React.RefObject<HTMLDivElement>;
  workAreaRef: React.RefObject<HTMLDivElement>;
  editorRowRef: React.RefObject<HTMLDivElement>;
  sidebarWidth: number;
  /** Editor share of the editor/preview row, 0..1. 0 = use the 50/50 default. */
  editorRatio: number;
  logHeight: number;
  startSidebarDrag: () => void;
  dragSidebar: (clientX: number) => void;
  endSidebarDrag: () => void;
  startEditorDrag: () => void;
  dragEditor: (clientX: number) => void;
  endEditorDrag: () => void;
  startLogDrag: () => void;
  dragLog: (clientY: number) => void;
  endLogDrag: () => void;
}

export function usePaneLayout(settings: Settings): PaneLayout {
  const mainRef = useRef<HTMLDivElement>(null);
  const workAreaRef = useRef<HTMLDivElement>(null);
  // The row that actually contains editor | splitter | preview. Measuring the
  // outer .workArea instead made the clamp wrong, because that column also
  // holds the tab bar and the problems panel.
  const editorRowRef = useRef<HTMLDivElement>(null);

  // Pane sizes (live state, drives render). 0 = "use the CSS default".
  const [sidebarWidth, setSidebarWidth] = useState<number>(0);
  const [editorRatio, setEditorRatio] = useState<number>(0);
  const [logHeight, setLogHeight] = useState<number>(0);

  // Ref mirrors, readable from the stale drag closures (see note 1 above).
  const sidebarWidthRef = useRef(0);
  const editorRatioRef = useRef(0);
  const logHeightRef = useRef(0);

  function applySidebarWidth(v: number) {
    sidebarWidthRef.current = v;
    setSidebarWidth(v);
  }
  function applyEditorRatio(v: number) {
    editorRatioRef.current = v;
    setEditorRatio(v);
  }
  function applyLogHeight(v: number) {
    logHeightRef.current = v;
    setLogHeight(v);
  }

  // Seed from persisted settings exactly once, after they load (see note 2).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (!useSettingsStore.getState().loaded) return;
    seededRef.current = true;
    if (settings.pane_sidebar_width >= 200) applySidebarWidth(settings.pane_sidebar_width);
    if (settings.pane_editor_ratio > 0) applyEditorRatio(settings.pane_editor_ratio);
    if (settings.pane_log_height > 60) applyLogHeight(settings.pane_log_height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.pane_sidebar_width, settings.pane_editor_ratio, settings.pane_log_height]);

  function startSidebarDrag() {
    /* nothing — width state already current */
  }
  function dragSidebar(clientX: number) {
    const main = mainRef.current;
    if (!main) return;
    const left = main.getBoundingClientRect().left;
    // Lower bound matches the sidebar's CSS `min-width: 200px` — using 160 here
    // (as we did previously) created a 160-200px dead zone where the pixel
    // width persisted but the visible width didn't change.
    applySidebarWidth(Math.max(200, Math.min(640, clientX - left)));
  }
  function endSidebarDrag() {
    void useSettingsStore
      .getState()
      .patchAndSave({ pane_sidebar_width: sidebarWidthRef.current });
  }

  function startEditorDrag() {
    /* nothing */
  }
  function dragEditor(clientX: number) {
    const row = editorRowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    if (rect.width <= MIN_PANE_PX * 2) return; // too narrow to split meaningfully
    const rawPx = clientX - rect.left;
    // Clamp in pixels so both panes stay usable, then convert to a ratio.
    const px = Math.max(MIN_PANE_PX, Math.min(rect.width - MIN_PANE_PX, rawPx));
    applyEditorRatio(px / rect.width);
  }
  function endEditorDrag() {
    void useSettingsStore
      .getState()
      .patchAndSave({ pane_editor_ratio: editorRatioRef.current });
  }

  function startLogDrag() {
    /* nothing */
  }
  function dragLog(clientY: number) {
    const work = workAreaRef.current;
    if (!work) return;
    // The splitter sits above the log panel; dragging up (smaller clientY)
    // grows the panel. Height = distance from pointer to the workArea bottom.
    const bottom = work.getBoundingClientRect().bottom;
    applyLogHeight(Math.max(80, Math.min(work.clientHeight - 120, bottom - clientY)));
  }
  function endLogDrag() {
    void useSettingsStore.getState().patchAndSave({ pane_log_height: logHeightRef.current });
  }

  return {
    mainRef,
    workAreaRef,
    editorRowRef,
    sidebarWidth,
    editorRatio,
    logHeight,
    startSidebarDrag,
    dragSidebar,
    endSidebarDrag,
    startEditorDrag,
    dragEditor,
    endEditorDrag,
    startLogDrag,
    dragLog,
    endLogDrag,
  };
}
