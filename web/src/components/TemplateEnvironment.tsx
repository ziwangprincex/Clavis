import { useEffect, useState } from 'react';
import { ipc } from '../api/tauri';
import { t } from '../i18n';
import { describeEngineStatus, type ProbeResult } from './engineStatus';
import styles from './WriterDialog.module.css';

// The bundled LaTeX starter declares pdflatex in its clavis.toml.
export function TemplateEnvironment({ onSettings, enabled = true }: { onSettings?: () => void; enabled?: boolean }) {
  const [result, setResult] = useState<ProbeResult>(null);
  const [attempt, setAttempt] = useState(0);
  const [probing, setProbing] = useState(true);
  useEffect(() => {
    let alive = true;
    if (!enabled) return;
    setProbing(true);
    ipc.detectLatexEngines().then(
      engines => { if (alive) { setResult(engines); setProbing(false); } },
      () => { if (alive) { setResult('failed'); setProbing(false); } },
    );
    return () => { alive = false; };
  }, [attempt, enabled]);
  const status = describeEngineStatus(result, 'pdflatex', probing);
  return <div className={styles.readiness}>
    <p role="status">{probing ? t('Checking local TeX tools…')
      : status.kind === 'found' ? t('pdflatex is available. Packages are checked when you compile.')
      : status.kind === 'failed' ? t('Could not check TeX tools. You can still create and edit the document.')
      : t('pdflatex was not found. Install a TeX distribution or configure its path in Settings → LaTeX. You can create the document now and compile later.')}</p>
    {!probing && status.kind !== 'found' && <div className={styles.inlineActions}>
      {onSettings && <button type="button" onClick={onSettings}>{t('Open settings')}</button>}
      <button type="button" onClick={() => setAttempt(value => value + 1)}>{t('Check again')}</button>
    </div>}
  </div>;
}
