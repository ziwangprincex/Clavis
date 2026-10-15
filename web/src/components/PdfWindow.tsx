// The PDF window's whole page: the viewer, fed and steered by the main window.

import { useEffect } from 'react';
import { useSettingsStore } from '../store';
import { useAppTheme } from '../hooks/useAppTheme';
import { sendSyncTex, usePdfWindowFollow } from '../pdf/pdfWindow';
import { PdfViewer } from './PdfViewer';
import styles from './PdfWindow.module.css';

export function PdfWindow() {
  const settings = useSettingsStore(s => s.settings);
  const load = useSettingsStore(s => s.load);
  useEffect(() => { void load(); }, [load]);
  // Settings changed in the main window (dark paper) apply here when focused again;
  // this window's own two-page choice is kept.
  useEffect(() => {
    const reload = async () => {
      const spread = useSettingsStore.getState().settings.pdf_spread;
      await load();
      useSettingsStore.setState(state => ({ settings: { ...state.settings, pdf_spread: spread } }));
    };
    const onFocus = () => { void reload(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);
  useAppTheme(settings);
  usePdfWindowFollow();
  return <div className={styles.root}>
    <PdfViewer standalone onSyncTexBackward={sendSyncTex} />
  </div>;
}
