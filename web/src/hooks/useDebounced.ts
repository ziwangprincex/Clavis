import { useEffect, useState } from 'react';

/** `value`, updated only after it has been stable for `ms`. A new `key` (e.g.
 *  another document) takes effect at once instead of after the delay. */
export function useDebounced<T>(value: T, ms: number, key?: unknown): T {
  const [settled, setSettled] = useState({ value, key });
  // Settle at once on a new key; edits under that key are then debounced.
  if (settled.key !== key) setSettled({ value, key });
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ value, key }), ms);
    return () => clearTimeout(timer);
  }, [value, ms, key]);
  return settled.key === key ? settled.value : value;
}
