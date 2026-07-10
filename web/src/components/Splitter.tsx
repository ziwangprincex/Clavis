// Splitter — drag handle that resizes an adjacent pane.
//
// Horizontal (default): a vertical bar between two side-by-side flex children;
// reports absolute clientX. Vertical: a horizontal bar between stacked children;
// reports absolute clientY. The parent converts the coordinate to a size delta.

import { useCallback, useRef } from 'react';
import styles from './Splitter.module.css';

export interface SplitterProps {
  /** Called continuously during drag with the absolute pointer coordinate
   *  (clientX for horizontal, clientY for vertical). */
  onDrag: (coord: number) => void;
  /** Called once when drag starts (capture starting sizes). */
  onDragStart?: () => void;
  /** Called once on drag end. */
  onDragEnd?: () => void;
  /** 'horizontal' (default) resizes left/right; 'vertical' resizes top/bottom. */
  orientation?: 'horizontal' | 'vertical';
}

export function Splitter({ onDrag, onDragStart, onDragEnd, orientation = 'horizontal' }: SplitterProps) {
  const draggingRef = useRef(false);
  const vertical = orientation === 'vertical';

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      onDragStart?.();
      document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev: MouseEvent) {
        if (!draggingRef.current) return;
        onDrag(vertical ? ev.clientY : ev.clientX);
      }
      function onUp() {
        draggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        onDragEnd?.();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [onDrag, onDragStart, onDragEnd, vertical],
  );

  return (
    <div
      className={vertical ? styles.splitterVertical : styles.splitter}
      onMouseDown={onMouseDown}
      role="separator"
    />
  );
}
