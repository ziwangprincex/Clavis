// RecentMenu — small dropdown listing recent files. Click to open.

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../store';
import { IconFolder } from './icons';
import styles from './RecentMenu.module.css';

export interface RecentMenuProps {
  open: boolean;
  onClose: () => void;
  onPickPath: (path: string) => void;
  /** Open a recent workspace folder. */
  onPickFolder?: (path: string) => void;
  /** Called when user clicks "Clear list" */
  onClear?: () => void;
}

export function RecentMenu({ open, onClose, onPickPath, onPickFolder, onClear }: RecentMenuProps) {
  const recent = useSettingsStore(s => s.settings.recent_files ?? []);
  const recentFolders = useSettingsStore(s => s.settings.recent_folders ?? []);
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

  const nothing = recent.length === 0 && recentFolders.length === 0;

  return (
    <div ref={wrapRef} className={styles.menu} role="menu">
      {nothing ? (
        <div className={styles.empty}>No recent items</div>
      ) : (
        <>
          {recentFolders.length > 0 && onPickFolder && (
            <>
              <div className={styles.groupLabel}>Folders</div>
              <ul className={styles.list}>
                {recentFolders.map((p, i) => (
                  <li
                    key={`d${i}`}
                    className={styles.item}
                    onClick={() => {
                      onPickFolder(p);
                      onClose();
                    }}
                    title={p}
                  >
                    <span className={styles.short}><IconFolder size={12} /> {shorten(p)}</span>
                    <span className={styles.full}>{p}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {recent.length > 0 && (
            <>
              {recentFolders.length > 0 && onPickFolder && (
                <div className={styles.groupLabel}>Files</div>
              )}
              <ul className={styles.list}>
                {recent.map((p, i) => (
                  <li
                    key={`f${i}`}
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
            </>
          )}
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
