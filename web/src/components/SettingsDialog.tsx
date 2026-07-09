import { useEffect, useState } from 'react';
import { useSettingsStore, defaultSettings } from '../store';
import type { Settings } from '../store/settings';
import { BUILTIN_THEMES } from '../editor/controller';
import styles from './SettingsDialog.module.css';

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const stored = useSettingsStore(s => s.settings);
  const patchAndSave = useSettingsStore(s => s.patchAndSave);
  const [draft, setDraft] = useState<Settings>(stored);

  useEffect(() => {
    if (open) setDraft(stored);
  }, [open, stored]);

  if (!open) return null;

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  async function onSave() {
    await patchAndSave(draft);
    onClose();
  }

  function onReset() {
    setDraft(defaultSettings);
  }

  return (
    <div
      className={styles.backdrop}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-label="Settings">
        <header className={styles.header}>
          <h2>Settings</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3>Appearance</h3>
            <label>
              UI theme
              <select
                value={draft.ui_theme}
                onChange={e => update('ui_theme', e.target.value as 'auto' | 'dark' | 'light')}
              >
                <option value="auto">Auto (follow system)</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label>
              UI font family
              <input
                type="text"
                value={draft.ui_font_family}
                onChange={e => update('ui_font_family', e.target.value)}
                placeholder='-apple-system, "Segoe UI", sans-serif'
              />
            </label>
            <label>
              UI font size (px)
              <input
                type="number"
                min={10}
                max={20}
                value={draft.ui_font_size}
                onChange={e => update('ui_font_size', +e.target.value || 13)}
              />
            </label>
            <label>
              Accent color
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  value={draft.ui_accent_color || '#007aff'}
                  onChange={e => update('ui_accent_color', e.target.value)}
                  style={{ width: 36, height: 24, padding: 0, borderRadius: 4 }}
                />
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => update('ui_accent_color', '')}
                >
                  Reset
                </button>
              </span>
            </label>
          </section>

          <section className={styles.section}>
            <h3>Preview</h3>
            <label>
              Preview font family
              <input
                type="text"
                value={draft.preview_font_family}
                onChange={e => update('preview_font_family', e.target.value)}
              />
            </label>
            <label>
              Preview font size (px)
              <input
                type="number"
                min={10}
                max={32}
                value={draft.preview_font_size}
                onChange={e => update('preview_font_size', +e.target.value || 14)}
              />
            </label>
          </section>

          <section className={styles.section}>
            <h3>LaTeX</h3>
            <label>
              Engine
              <select
                value={draft.latex_engine}
                onChange={e => update('latex_engine', e.target.value)}
              >
                <option value="pdflatex">pdflatex</option>
                <option value="xelatex">xelatex</option>
                <option value="lualatex">lualatex</option>
              </select>
            </label>
            <label>
              Bibliography engine
              <select
                value={draft.bib_engine}
                onChange={e => update('bib_engine', e.target.value as Settings['bib_engine'])}
              >
                <option value="auto">auto</option>
                <option value="bibtex">bibtex</option>
                <option value="biber">biber</option>
                <option value="none">none</option>
              </select>
            </label>
            <label className={styles.inline}>
              <input
                type="checkbox"
                checked={draft.auto_rerun}
                onChange={e => update('auto_rerun', e.target.checked)}
              />
              Auto rerun for cross-references
            </label>
            <label>
              Max runs
              <input
                type="number"
                min={1}
                max={8}
                value={draft.max_runs}
                onChange={e => update('max_runs', Math.max(1, Math.min(8, +e.target.value || 1)))}
              />
            </label>
          </section>

          <section className={styles.section}>
            <h3>PDF Preview</h3>
            <label>
              Dark mode
              <select
                value={draft.pdf_dark_mode}
                onChange={e => update('pdf_dark_mode', e.target.value)}
              >
                <option value="off">Off (white paper)</option>
                <option value="invert">Invert colors</option>
                <option value="sepia">Sepia</option>
              </select>
            </label>
            <label>
              Background color
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  value={draft.pdf_bg_color || '#ffffff'}
                  onChange={e => update('pdf_bg_color', e.target.value)}
                  style={{ width: 36, height: 24, padding: 0, borderRadius: 4 }}
                />
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => update('pdf_bg_color', '')}
                >
                  Reset
                </button>
              </span>
            </label>
          </section>

          <section className={styles.section}>
            <h3>Editor</h3>
            <label>
              Theme
              <select
                value={draft.editor_theme}
                onChange={e => update('editor_theme', e.target.value)}
              >
                {Object.entries(BUILTIN_THEMES).map(([key, spec]) => (
                  <option key={key} value={key}>
                    {spec.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Font family
              <input
                type="text"
                value={draft.editor_font_family}
                onChange={e => update('editor_font_family', e.target.value)}
              />
            </label>
            <label>
              Font size
              <input
                type="number"
                min={8}
                max={48}
                value={draft.editor_font_size}
                onChange={e => update('editor_font_size', +e.target.value || 14)}
              />
            </label>
            <label>
              Line height
              <input
                type="number"
                min={1}
                max={3}
                step={0.05}
                value={draft.editor_line_height}
                onChange={e => update('editor_line_height', +e.target.value || 1.55)}
              />
            </label>
            <label className={styles.inline}>
              <input
                type="checkbox"
                checked={draft.editor_spellcheck}
                onChange={e => update('editor_spellcheck', e.target.checked)}
              />
              Enable browser spellcheck (English)
            </label>
            <label className={styles.inline}>
              <input
                type="checkbox"
                checked={draft.autosave_enabled}
                onChange={e => update('autosave_enabled', e.target.checked)}
              />
              Autosave open files to disk (every 30s)
            </label>
            <label>
              Tab size (spaces)
              <input
                type="number"
                min={1}
                max={8}
                value={draft.editor_tab_size}
                onChange={e => update('editor_tab_size', Math.max(1, Math.min(8, +e.target.value || 2)))}
              />
            </label>
            <label className={styles.inline}>
              <input
                type="checkbox"
                checked={draft.editor_indent_with_spaces}
                onChange={e => update('editor_indent_with_spaces', e.target.checked)}
              />
              Indent with spaces (uncheck for hard tabs)
            </label>
          </section>

          <section className={styles.section}>
            <h3>Editor color overrides</h3>
            <p className={styles.hint}>Leave a field blank to fall back to the theme default.</p>
            <div className={styles.colorGrid}>
              {(
                [
                  ['bg', 'Background'],
                  ['fg', 'Foreground'],
                  ['gutter_bg', 'Gutter bg'],
                  ['gutter_fg', 'Gutter fg'],
                  ['active_bg', 'Active line'],
                  ['cursor', 'Cursor'],
                  ['selection', 'Selection'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className={styles.colorRow}>
                  <span>{label}</span>
                  <input
                    type="color"
                    value={draft.editor_theme_overrides[key] ?? '#000000'}
                    onChange={e => {
                      const next = { ...draft.editor_theme_overrides, [key]: e.target.value };
                      update('editor_theme_overrides', next);
                    }}
                  />
                  <button
                    type="button"
                    className={styles.clearColor}
                    onClick={() => {
                      const next = { ...draft.editor_theme_overrides };
                      delete next[key];
                      update('editor_theme_overrides', next);
                    }}
                    title="Clear override"
                  >
                    ×
                  </button>
                </label>
              ))}
            </div>
          </section>
        </div>

        <footer className={styles.footer}>
          <button className={styles.secondary} onClick={onReset}>
            Reset to defaults
          </button>
          <div className={styles.spacer} />
          <button className={styles.secondary} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.primary} onClick={onSave}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
