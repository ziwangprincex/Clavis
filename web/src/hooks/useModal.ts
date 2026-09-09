import { useEffect, useRef, type KeyboardEvent } from 'react';

/** Modal-local keys never reach document shortcuts; native text editing is preserved. */
export function useModal(open: boolean, onClose: () => void, busy = false) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => { previous?.focus?.(); };
  }, [open]);
  function onKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape' && !event.defaultPrevented && !busy) {
      event.preventDefault();
      onClose();
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
    ) ?? []).filter(item => !item.closest('[hidden]') && item.getClientRects().length > 0);
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); return; }
    const current = document.activeElement;
    if (event.shiftKey && (current === first || current === ref.current)) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (current === last || current === ref.current)) {
      event.preventDefault(); first.focus();
    }
  }
  return { ref, onKeyDown, tabIndex: -1, 'aria-modal': true as const };
}
