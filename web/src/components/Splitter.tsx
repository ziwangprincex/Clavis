// Splitter — vertical drag handle that resizes the element to its left.
//
// Usage: place between two flex children. Pass `onResize(deltaX)`; the parent
// converts that to a width delta on the left pane.

import { useCallback, useRef } from 'react';
import styles from './Splitter.module.css';

export interface SplitterProps {
  /** Called continuously during drag with absolute clientX. */
  onDrag: (clientX: number) => void;
  /** Called once when drag starts (capture starting widths). */
  onDragStart?: () => void;
  /** Called once on drag end. */
  onDragEnd?: () => void;
}

export function Splitter({ onDrag, onDragStart, onDragEnd }: SplitterProps) {
  const draggingRef = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      onDragStart?.();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev: MouseEvent) {
        if (!draggingRef.current) return;
        onDrag(ev.clientX);
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
    [onDrag, onDragStart, onDragEnd],
  );

  return <div className={styles.splitter} onMouseDown={onMouseDown} role="separator" />;
}
