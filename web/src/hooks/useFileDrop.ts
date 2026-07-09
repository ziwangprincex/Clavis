// Subscribes to OS file-drop events: dropping a file opens it, dropping a
// folder sets the workspace. Extracted verbatim from App.tsx.

import { useEffect } from 'react';
import { hasTauri, events } from '../api/tauri';
import { openFileByPath } from '../files/files';

export function useFileDrop(onDropFolder: (path: string) => void): void {
  useEffect(() => {
    if (!hasTauri()) return;
    let off: (() => void) | undefined;
    events.onFileDrop(paths => {
      if (!paths?.length) return;
      const first = paths[0];
      // Heuristic: directories don't have an extension. Better would be to
      // call fs.exists or stat, but the legacy code took the same shortcut.
      const looksLikeDir = !/\.[^\\/]+$/.test(first);
      if (looksLikeDir) onDropFolder(first);
      else void openFileByPath(first);
    }).then(unlisten => {
      off = unlisten;
    });
    return () => off?.();
    // Registered once; onDropFolder is a stable setState updater.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
