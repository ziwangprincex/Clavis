import { useId } from 'react';
import { t } from '../i18n';
import { fontStack, missingFonts, primaryFamily } from '../theme/typography';
import styles from './SettingsDialog.module.css';

export function FontField({ label, value, onChange, fonts, fallback = 'Default', inheritedFamily, size = 17, lineHeight = 1.6, weight = 400 }: {
  label: string; value: string; onChange: (value: string) => void;
  fonts: string[] | null | undefined; fallback?: string; inheritedFamily?: string; size?: number; lineHeight?: number; weight?: number;
}) {
  const id = useId();
  const missing = fonts ? missingFonts(value, fonts) : [];
  // The control names the font in use; a stack led by the system font reads as the default.
  const family = primaryFamily(value);
  return <div className={styles.fontField}>
    <label htmlFor={id}>{t(label)}</label>
    <select id={id} value={family ?? ''} onChange={event => onChange(event.target.value && fontStack(event.target.value))}>
      <option value="">{t(fallback)}</option>
      {family && !fonts?.includes(family) && <option value={family}>{family}</option>}
      {fonts?.map(font => <option key={font} value={font}>{font}</option>)}
    </select>
    <details className={styles.fontOrder}>
      <summary>{t('Font fallback order')}</summary>
      <input type="text" value={value} aria-label={`${t(label)} · ${t('Font fallback order')}`} onChange={event => onChange(event.target.value)} />
    </details>
    <div className={styles.fontSample} style={{ fontFamily: value || inheritedFamily || undefined, fontSize: size, lineHeight, fontWeight: weight }}>
      {t('中文排版 · A quiet thought · 0123456789')}
    </div>
    {fonts === undefined && <p className={styles.hint}>{t('Loading installed fonts…')}</p>}
    {fonts === null && <p className={styles.hint}>{t('Font list unavailable. A font family can be entered manually.')}</p>}
    {!!missing.length && <p className={styles.hint}>{t('Not installed: {names}. The next available font in the list is used.', { names: missing.join(', ') })}</p>}
  </div>;
}
