// Splitter — drag handle that resizes an adjacent pane.
//
// A vertical bar between two side-by-side flex children; reports absolute
// clientX. The parent converts the coordinate to a size.
//
// The mousemove/mouseup listeners are installed once per mousedown and live for
// the duration of the drag. They must therefore never close over a stale
// callback: the parent re-renders on every mousemove (pane size is React state),
// so the `onDrag`/`onDragEnd` props are new function identities by the time the
// drag ends. We keep the latest props in refs and have the listeners read those.
// Without this, `onDragEnd` fires the version captured at mousedown, which
// persists the pre-drag size and makes the splitter snap back.

import { useCallback, useEffect, useRef } from 'react';
import styles from './Splitter.module.css';

export interface SplitterProps {
  /** Called continuously during drag with the absolute pointer clientX. */
  onDrag: (clientX: number) => void;
  /** Called once when drag starts (capture starting sizes). */
  onDragStart?: () => void;
  /** Called once on drag end. */
  onDragEnd?: () => void;
}

export function Splitter({ onDrag, onDragStart, onDragEnd }: SplitterProps) {
  const draggingRef = useRef(false);

  // Always-current handler refs (see the note at the top of this file).
  const onDragRef = useRef(onDrag);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef = useRef(onDragEnd);
  onDragRef.current = onDrag;
  onDragStartRef.current = onDragStart;
  onDragEndRef.current = onDragEnd;

  // Cleanup guard: if the splitter unmounts mid-drag (e.g. the sidebar is
  // hidden), restore the document-level cursor/selection overrides.
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only respond to the primary button; a right-click drag shouldn't resize.
      if (e.button !== 0) return;
      e.preventDefault();
      draggingRef.current = true;
      onDragStartRef.current?.();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev: MouseEvent) {
        if (!draggingRef.current) return;
        onDragRef.current(ev.clientX);
      }
      function finish() {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', finish);
        window.removeEventListener('blur', finish);
        onDragEndRef.current?.();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', finish);
      // If focus leaves the window mid-drag we'd otherwise never see mouseup and
      // the drag would stay armed.
      window.addEventListener('blur', finish);
    },
    [],
  );

  return (
    <div
      className={styles.splitter}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
    />
  );
}
