// RecentMenu — small dropdown listing recent files. Click to open.

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../store';
import styles from './RecentMenu.module.css';

export interface RecentMenuProps {
  open: boolean;
  onClose: () => void;
  onPickPath: (path: string) => void;
  /** Called when user clicks "Clear list" */
  onClear?: () => void;
}

export function RecentMenu({ open, onClose, onPickPath, onClear }: RecentMenuProps) {
  const recent = useSettingsStore(s => s.settings.recent_files ?? []);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onDocKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  function shorten(p: string): string {
    const parts = p.split(/[\\/]/);
    if (parts.length <= 2) return p;
    return parts.slice(-2).join('/');
  }

  return (
    <div ref={wrapRef} className={styles.menu} role="menu">
      {recent.length === 0 ? (
        <div className={styles.empty}>No recent files</div>
      ) : (
        <>
          <ul className={styles.list}>
            {recent.map((p, i) => (
              <li
                key={i}
                className={styles.item}
                onClick={() => {
                  onPickPath(p);
                  onClose();
                }}
                title={p}
              >
                <span className={styles.short}>{shorten(p)}</span>
                <span className={styles.full}>{p}</span>
              </li>
            ))}
          </ul>
          {onClear && (
            <button
              className={styles.clearBtn}
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              Clear list
            </button>
          )}
        </>
      )}
    </div>
  );
}
