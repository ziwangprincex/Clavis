import { t } from '../i18n';
import { useId, type CSSProperties } from 'react';
import { BUILTIN_THEMES, SIGNATURE_THEMES, type ThemeSpec } from '../theme/themes';
import { chromeTokens } from '../theme/chromeTokens';
import styles from './ThemePicker.module.css';

export function ThemePicker({ value, selectedSpec, onChange, overrides = {}, uiFont, monoFont }: {
  value: string;
  overrides?: Record<string, string>;
  uiFont?: string;
  monoFont?: string;
  selectedSpec: ThemeSpec;
  onChange: (id: string) => void;
}) {
  const name = useId();
  return (
    <fieldset className={styles.picker}>
      <legend className={styles.legend}>{t("A space for your words")}</legend>
      <p className={styles.intro}>{t("Four quiet palettes, from the first draft to the last page.")}</p>
      <div className={styles.grid}>
        {SIGNATURE_THEMES.map(id => {
          const checked = value === id;
          const spec = checked ? selectedSpec : BUILTIN_THEMES[id];
          const tokens = { ...chromeTokens(spec), ...(checked ? Object.fromEntries(Object.entries(overrides).filter(([, value]) => value).map(([key, value]) => [`--${key}`, value])) : {}), ...(uiFont ? { '--font-sans': uiFont } : {}), ...(monoFont ? { '--font-mono': monoFont } : {}) };
          return (
            <label key={id} className={styles.choice}>
              <input type="radio" name={name} value={id} checked={checked}
                aria-label={BUILTIN_THEMES[id].label} onChange={() => onChange(id)} />
              <span className={styles.sample} style={tokens as CSSProperties} aria-hidden="true">
                <span className={styles.sampleBar}>
                  <span className={styles.sampleDot} /><span className={styles.sampleDot} /><span className={styles.sampleDot} />
                  <span className={styles.sampleTitle}>{t("A quiet thought")}</span>
                </span>
                <span className={styles.sampleBody}>
                  <span className={styles.sampleRail}>
                    <span className={styles.sampleActive} /><span /><span />
                  </span>
                  <span className={styles.sampleDocument}>
                    <span className={styles.sampleHeading}>{t("Room to think.")}</span>
                    <span className={styles.sampleSentence}>{t("Let the words come first.")}</span>
                    <span className={styles.sampleCode} style={{ color: spec.syntax?.name ?? spec.accent }}>
                      {'\\section'}<span style={{ color: spec.syntax?.literal ?? spec.fg }}>{'{Introduction}'}</span>
                    </span>
                    <span className={styles.sampleLine} />
                  </span>
                </span>
              </span>
              <span className={styles.caption}>
                <span className={styles.name}>{BUILTIN_THEMES[id].label.replace('Clavis ', '')}</span>
                <span className={styles.check} aria-hidden="true">{checked ? '✓' : ''}</span>
                <span className={styles.description}>{t(BUILTIN_THEMES[id].description ?? '')}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
