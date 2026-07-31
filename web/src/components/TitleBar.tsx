// TitleBar — self-drawn window titlebar for the frameless Windows shell.
//
// The whole strip is `data-tauri-drag-region` (root only — Tauri's exact-target
// check auto-excludes children, so buttons don't need any opt-out). Single-click
// drag, double-click maximize are handled by Tauri's core.js. Our caption buttons
// (min / max-restore / close) call into `appWindow` wrappers.
//
// On macOS the traffic lights stay (we keep `decorations: true` there), so this
// component renders only the brand + drag region with no buttons — the existing
// `.is-mac { padding-left: 84px }` in Toolbar.module.css moved here.

import { useCallback, useEffect, useState } from 'react';
import { hasTauri, appWindow } from '../api/tauri';
import {
  IconWinClose,
  IconWinMaximize,
  IconWinMinimize,
  IconWinRestore,
} from './icons';
import styles from './TitleBar.module.css';

export interface TitleBarProps {
  title?: string;
}

function isMac(): boolean {
  return typeof document !== 'undefined' && document.body.classList.contains('is-mac');
}

export function TitleBar({ title = 'Clavis' }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const mac = isMac();

  // Refresh maximized state on mount and on native resize events.
  useEffect(() => {
    if (!hasTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const refresh = () => {
      appWindow.isMaximized()
        .then(v => { if (!cancelled) setMaximized(v); })
        .catch(() => {});
    };
    refresh();
    appWindow
      .onResized(refresh)
      .then(fn => { if (cancelled) fn(); else unlisten = fn; })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const onMinimize = useCallback(() => {
    if (hasTauri()) appWindow.minimize().catch(() => {});
  }, []);
  const onMaximize = useCallback(() => {
    if (hasTauri()) appWindow.toggleMaximize().catch(() => {});
  }, []);
  const onClose = useCallback(() => {
    if (hasTauri()) appWindow.close().catch(() => {});
  }, []);

  return (
    <div
      className={`${styles.titlebar} ${mac ? styles.mac : ''}`}
      data-tauri-drag-region
    >
      <span className={styles.brand} data-tauri-drag-region>
        {title}
      </span>

      {/* Windows-style caption buttons on the right; hidden on macOS
       *  (traffic lights come from the native decorated window there). */}
      {!mac && hasTauri() && (
        <div className={styles.controls}>
          <button
            className={styles.ctrlBtn}
            onClick={onMinimize}
            aria-label="Minimize"
            title="Minimize"
          >
            <IconWinMinimize size={10} />
          </button>
          <button
            className={styles.ctrlBtn}
            onClick={onMaximize}
            aria-label={maximized ? 'Restore' : 'Maximize'}
            title={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? <IconWinRestore size={10} /> : <IconWinMaximize size={10} />}
          </button>
          <button
            className={`${styles.ctrlBtn} ${styles.closeBtn}`}
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <IconWinClose size={10} />
          </button>
        </div>
      )}
    </div>
  );
}
