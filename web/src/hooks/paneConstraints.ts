import type { EditorLayout } from '../store/settings';

export const DEFAULT_SIDEBAR_PX = 232;
export const MIN_SIDEBAR_PX = 200;
export const MIN_PANE_PX = 220;
const SPLITTER_PX = 1;

/** Keep the preferred width separate so enlarging the window restores it. */
export function constrainSidebarWidth(preferred: number, mainWidth: number, layout: EditorLayout): number {
  const desired = Number.isFinite(preferred) && preferred > 0 ? preferred : DEFAULT_SIDEBAR_PX;
  const workMin = layout === 'split' ? MIN_PANE_PX * 2 + SPLITTER_PX : 320;
  const max = mainWidth > 0 ? Math.min(640, mainWidth - workMin - SPLITTER_PX) : 640;
  return Math.max(MIN_SIDEBAR_PX, Math.min(max, desired));
}

/** Re-clamp a persisted ratio after resize, not only while dragging. */
export function constrainEditorRatio(preferred: number, rowWidth: number): number {
  const ratio = Number.isFinite(preferred) && preferred > 0 ? preferred : 1.12 / 2.12;
  const available = rowWidth - SPLITTER_PX;
  if (available <= MIN_PANE_PX * 2) return 0.5;
  const min = MIN_PANE_PX / available;
  return Math.max(min, Math.min(1 - min, ratio));
}
