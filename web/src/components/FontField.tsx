import { useId } from 'react';
import { t } from '../i18n';
import { fontStack, missingFonts } from '../theme/typography';
import styles from './SettingsDialog.module.css';

export function FontField({ label, value, onChange, fonts, fallback, inheritedFamily, size = 17, lineHeight = 1.6, weight = 400 }: {
  label: string; value: string; onChange: (value: string) => void;
  fonts: string[] | null | undefined; fallback?: string; inheritedFamily?: string; size?: number; lineHeight?: number; weight?: number;
}) {
  const id = useId();
  const missing = fonts ? missingFonts(value, fonts) : [];
  return <div className={styles.fontField}>
    <label htmlFor={id}>{t(label)}</label>
    <select aria-label={`${t(label)} · ${t('Choose installed font…')}`} value="" onChange={event => {
      if (event.target.value) onChange(fontStack(event.target.value));
    }}>
      <option value="">{t('Choose installed font…')}</option>
      {fonts?.map(font => <option key={font} value={font}>{font}</option>)}
    </select>
    <input id={id} type="text" value={value} placeholder={fallback ? t(fallback) : undefined}
      aria-description={t('Font fallback order')} onChange={event => onChange(event.target.value)} />
    {fallback && <button type="button" className={styles.secondary} onClick={() => onChange('')}>{t(fallback)}</button>}
    <div className={styles.fontSample} style={{ fontFamily: value || inheritedFamily || undefined, fontSize: size, lineHeight, fontWeight: weight }}>
      {t('中文排版 · A quiet thought · 0123456789')}
    </div>
    {fonts === undefined && <p className={styles.hint}>{t('Loading installed fonts…')}</p>}
    {fonts === null && <p className={styles.hint}>{t('Font list unavailable. You can still enter a font family.')}</p>}
    {!!missing.length && <p className={styles.hint}>{t('Not installed: {names}. Later fonts in the list will be used.', { names: missing.join(', ') })}</p>}
  </div>;
}
