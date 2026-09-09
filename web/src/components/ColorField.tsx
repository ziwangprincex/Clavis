import { useId } from 'react';
import { t } from '../i18n';
import styles from './ColorField.module.css';

/** A flat, labelled swatch; the native picker remains keyboard-accessible. */
export function ColorField({ label, value, overridden, onChange, onReset }: {
  label: string;
  value: string;
  overridden: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const id = useId();
  return <div className={styles.field} role="group" aria-labelledby={id}>
    <span id={id} className={styles.title}>{label}</span>
    <div className={styles.row}>
      <label className={styles.picker}>
        <input className={styles.swatch} type="color" value={value} aria-label={label}
          onChange={event => onChange(event.target.value)} />
        <span className={styles.hex} aria-hidden="true">{value.toUpperCase()}</span>
      </label>
      <button className={styles.reset} type="button" disabled={!overridden}
        onClick={onReset} aria-label={`${label} · ${t('Follow theme')}`}>
        {t('Follow theme')}
      </button>
    </div>
  </div>;
}
