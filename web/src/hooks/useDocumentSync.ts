import { useEffect } from 'react';
import { hasTauri } from '../api/tauri';
import { checkExternalDocuments } from '../files/documentSync';

export function useDocumentSync(): void {
  useEffect(() => {
    if (!hasTauri()) return;
    let alive = true;
    const check = (force = false) => {
      if (alive && document.visibilityState !== 'hidden') void checkExternalDocuments(force).catch(() => {});
    };
    const foreground = () => check(true);
    const timer = window.setInterval(() => check(), 4000);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    check(true);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, []);
}
