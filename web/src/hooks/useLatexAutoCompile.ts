import { useEffect } from 'react';
import { hasTauri } from '../api/tauri';
import { runLatexCompile } from '../compile/latex';
import type { Tab } from '../store/tabs';
import { useProjectStore, useSettingsStore } from '../store';

export function useLatexAutoCompile(tab: Tab | undefined, enabled: boolean) {
  const config = useProjectStore(s => s.workspace?.config);
  const loaded = useSettingsStore(s => s.loaded);
  useEffect(() => {
    if (!enabled || tab?.lang !== 'latex' || !hasTauri()) return;
    const timer = setTimeout(() => { void runLatexCompile(); }, 300);
    return () => clearTimeout(timer);
  }, [enabled, tab?.id, tab?.lang, tab?.content, tab?.filePath, tab?.projectRoot, tab?.latexEngineOverride, config, loaded]);
}
