import { t } from '../i18n';
import { IconClose, IconDoc, IconFolder } from './icons';
import styles from './StartActions.module.css';

export function StartActions({ onOpen, onFolder, onNew, onDismiss }: {
  onOpen: () => void; onFolder: () => void; onNew: () => void; onDismiss: () => void;
}) {
  return <nav className={styles.root} aria-label={t('Get started')}>
    <button onClick={onOpen}><IconDoc size={14} aria-hidden="true" />{t('Open file')}</button>
    <button onClick={onNew}>{t('New from template…')}</button>
    <button onClick={onFolder}><IconFolder size={14} aria-hidden="true" />{t('Open folder')}</button>
    <button className={styles.dismiss} onClick={onDismiss} aria-label={t('Dismiss start actions')} title={t('Dismiss start actions')}><IconClose size={12} aria-hidden="true" /></button>
  </nav>;
}
