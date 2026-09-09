import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore, defaultSettings } from '../store';
import type { Settings } from '../store/settings';
import { BUILTIN_THEMES } from '../theme/themes';
import { resolveThemeSpec, useOsDark } from '../theme/appTheme';
import { ThemePicker } from './ThemePicker';
import { getAppVersion, hasTauri, ipc } from '../api/tauri';
import { checkForUpdates } from '../update/updater';
import {
  BIB_ENGINES,
  LATEX_ENGINES,
  type ProbeResult,
  describeEngineStatus,
  engineLabel,
  isUnknownEngine,
} from './engineStatus';
import styles from './SettingsDialog.module.css';
import { FontField } from './FontField';
import { ColorField } from './ColorField';
import { headingSizes, previewTypography } from '../theme/typography';
import { useModal } from '../hooks/useModal';
import { t } from '../i18n';
import previewStyles from './PreviewPane.module.css';

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES = ['Appearance', 'Editor', 'LaTeX & PDF', 'Preview', 'Updates'] as const;
type Category = (typeof CATEGORIES)[number];

/// Every value the bibliography dropdown offers, including the two that name no
/// binary. Used only to decide whether a stored value is off-list.
const BIB_ENGINE_CHOICES = ['auto', 'none', ...BIB_ENGINES] as const;

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const stored = useSettingsStore(s => s.settings);
  const saveDraft = useSettingsStore(s => s.saveDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [fonts, setFonts] = useState<string[] | null>();
  const baseline = useRef(stored);
  const modal = useModal(open, onClose, saving);
  const [draft, setDraft] = useState<Settings>(stored);
  const [active, setActive] = useState<Category>('Appearance');
  const [version, setVersion] = useState<string>('');
  const [latexEngines, setLatexEngines] = useState<ProbeResult>(null);
  const [bibEngines, setBibEngines] = useState<ProbeResult>(null);
  const [probing, setProbing] = useState(false);
  // Generation gate: a slow probe resolving after the dialog reopened (or after
  // a newer Detect again) must not overwrite fresher state.
  const probeGeneration = useRef(0);
  const osDark = useOsDark(open && draft.editor_theme === 'auto');
  const draftTheme = resolveThemeSpec(draft.editor_theme, draft.editor_theme_overrides, osDark, draft.ui_accent_color);
  const sampleTheme = { ...draftTheme, accent: draft.ui_accent_color || draftTheme.accent };

  useEffect(() => {
    if (open) {
      baseline.current = useSettingsStore.getState().settings;
      setDraft(baseline.current);
      setSaveError('');
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (!hasTauri()) { setFonts(null); return; }
    let alive = true;
    ipc.listSystemFonts().then(value => { if (alive) setFonts(value); }, () => { if (alive) setFonts(null); });
    return () => { alive = false; };
  }, [open]);

  // Fetch the app version once the dialog opens (for the Updates pane).
  // getAppVersion() throws synchronously outside the Tauri shell (browser
  // preview), so guard on hasTauri() — an unguarded throw in this effect would
  // crash the whole dialog to a black screen.
  useEffect(() => {
    if (!open || !hasTauri()) return;
    getAppVersion().then(setVersion).catch(() => setVersion(''));
  }, [open]);

  // Probe installed engines. Each backend probe is bounded (3s per engine, then
  // killed), so this cannot hang the dialog. Guarded on hasTauri() for the same
  // reason as the version fetch above.
  //
  // A rejected IPC becomes 'failed', NOT an empty list: an empty list would
  // render as "not found" for every engine and blame the user's TeX install for
  // what is actually our own failed call.
  const detectEngines = useCallback(async () => {
    if (!hasTauri()) return;
    const generation = ++probeGeneration.current;
    setProbing(true);
    try {
      const [latex, bib] = await Promise.all([
        ipc.detectLatexEngines().then<ProbeResult>(r => r).catch<ProbeResult>(() => 'failed'),
        ipc.detectBibEngines().then<ProbeResult>(r => r).catch<ProbeResult>(() => 'failed'),
      ]);
      if (generation !== probeGeneration.current) return;
      setLatexEngines(latex);
      setBibEngines(bib);
    } finally {
      if (generation === probeGeneration.current) setProbing(false);
    }
  }, []);

  // Probe when the LaTeX pane is actually opened, not on every dialog open:
  // spawning up to five processes for someone visiting Appearance is waste.
  useEffect(() => {
    if (!open || active !== 'LaTeX & PDF') return;
    void detectEngines();
  }, [open, active, detectEngines]);

  if (!open) return null;

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  async function onSave() {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const delta = Object.fromEntries(Object.entries(draft).filter(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(baseline.current[key as keyof Settings]))) as Partial<Settings>;
      await saveDraft(delta);
      onClose();
    } catch (error) {
      setSaveError(t('Could not save settings: {error}', { error: String(error) }));
    } finally { setSaving(false); }
  }

  function onReset() {
    const keys: Record<Category, (keyof Settings)[]> = {
      Appearance: ['editor_theme', 'ui_font_family', 'ui_mono_font_family', 'ui_font_size', 'ui_accent_color', 'ui_color_overrides'],
      Editor: ['editor_font_family', 'editor_font_size', 'editor_line_height', 'editor_theme_overrides', 'editor_spellcheck', 'editor_tab_size', 'editor_indent_with_spaces', 'writing_main_word_limit', 'writing_abstract_word_limit', 'autosave_enabled'],
      Preview: ['preview_font_family', 'preview_font_size', 'preview_line_height', 'preview_heading_fonts', 'preview_heading_sizes', 'preview_heading_weights', 'preview_quote_font_family', 'preview_inline_code_font_family', 'preview_code_font_family', 'preview_paper', 'preview_reading_width'],
      'LaTeX & PDF': ['latex_engine', 'bib_engine', 'auto_rerun', 'max_runs', 'pdf_dark_mode'],
      Updates: [],
    };
    setDraft(value => ({ ...value, ...Object.fromEntries(keys[active].map(key => [key, defaultSettings[key]])) }));
  }

  return (
    <div
      className={styles.backdrop}
      onMouseDown={e => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <section {...modal} className={styles.modal} role="dialog" aria-label={t("Settings")}>
        <header className={styles.header}>
          <h2>{t("Settings")}</h2>
          <button className={styles.closeBtn} onClick={onClose} disabled={saving} aria-label={t("Close")}>
            ×
          </button>
        </header>

        <fieldset disabled={saving} className={styles.body}>
          <nav className={styles.nav} aria-label={t("Settings categories")}>
            {CATEGORIES.map(cat => (
              <button
                key={t(cat)}
                type="button"
                className={`${styles.navItem} ${active === cat ? styles.navItemActive : ''}`}
                aria-current={active === cat ? 'page' : undefined}
                onClick={() => setActive(cat)}
              >
                {t(cat)}
              </button>
            ))}
          </nav>

          <div className={styles.pane}>
            {active === 'Appearance' && (
              <section className={styles.section}>
                <label>
                  {t('Interface language')}
                  <select value={draft.ui_language} onChange={e => update('ui_language', e.target.value as Settings['ui_language'])}>
                    <option value="auto">{t('Follow system')}</option>
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <p className={styles.hint}>{t('Language changes after saving. Document contents and compiler output are not translated.')}</p>
                <ThemePicker value={draft.editor_theme} selectedSpec={sampleTheme} overrides={draft.ui_color_overrides} uiFont={draft.ui_font_family} monoFont={draft.ui_mono_font_family || draft.editor_font_family}
                  onChange={id => update('editor_theme', id)} />
                <label> {t("Theme")} <select
                    value={draft.editor_theme}
                    onChange={e => update('editor_theme', e.target.value)}
                  >
                    <option value="auto">{t("Auto (Paper by day, Ink by night)")}</option>
                    {Object.entries(BUILTIN_THEMES).map(([key, spec]) => (
                      <option key={key} value={key}>
                        {spec.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.hint}> {t("Save applies the palette to the whole window. Printed pages stay unchanged.")} {Object.keys(draft.editor_theme_overrides ?? {}).length > 0 || draft.ui_accent_color || Object.keys(draft.ui_color_overrides ?? {}).length > 0
                    ? t('Custom colors are kept; clear them to use the original palette.') : ''}
                </p>
                {(Object.keys(draft.editor_theme_overrides ?? {}).length > 0 || draft.ui_accent_color || Object.keys(draft.ui_color_overrides ?? {}).length > 0) && (
                  <button type="button" className={styles.secondary} style={{ marginBottom: 16 }}
                    onClick={() => setDraft(d => ({ ...d, editor_theme_overrides: {}, ui_color_overrides: {}, ui_accent_color: '' }))}> {t("Use original palette")} </button>
                )}
                <FontField label={t("UI font family")} value={draft.ui_font_family} onChange={value => update('ui_font_family', value)} fonts={fonts} inheritedFamily={defaultSettings.ui_font_family} size={draft.ui_font_size} />
                <FontField label={t("UI code font")} value={draft.ui_mono_font_family} onChange={value => update('ui_mono_font_family', value)} fonts={fonts} inheritedFamily={draft.editor_font_family} fallback="Follow editor" />
                <label> {t("UI font size (px)")} <input
                    type="number"
                    min={10}
                    max={20}
                    value={draft.ui_font_size}
                    onChange={e => update('ui_font_size', Math.max(10, Math.min(20, +e.target.value || 13)))}
                  />
                </label>
                <ColorField label={t('Accent color')} value={sampleTheme.accent}
                  overridden={!!draft.ui_accent_color}
                  onChange={value => update('ui_accent_color', value)}
                  onReset={() => update('ui_accent_color', '')} />
              </section>
            )}

            {active === 'Preview' && (
              <section className={styles.section}>
                <h3>{t("Preview")}</h3>
                <FontField label={t("Preview font family")} value={draft.preview_font_family} onChange={value => update('preview_font_family', value)} fonts={fonts} inheritedFamily={draft.ui_font_family || defaultSettings.ui_font_family} size={draft.preview_font_size} lineHeight={draft.preview_line_height} />
                <label> {t("Preview font size (px)")} <input
                    type="number"
                    min={10}
                    max={32}
                    value={draft.preview_font_size}
                    onChange={e => update('preview_font_size', Math.max(10, Math.min(32, +e.target.value || 17)))}
                  />
                </label>
                <label>{t('Line height')}<input type="number" min={1} max={3} step={0.05} value={draft.preview_line_height} onChange={e => update('preview_line_height', Math.max(1, Math.min(3, +e.target.value || 1.75)))} /></label>
                <p className={styles.hint}>{t('Headings and quotes follow the body unless overridden. Code follows the editor. Math, PDF and Typst fonts are controlled by the document.')}</p>
                <details className={styles.advanced}>
                  <summary>{t('Typography overrides')}</summary>
                  {Object.entries(headingSizes).map(([level, size]) => <div key={level} className={styles.headingField}>
                    <FontField label={t('Heading {level}', { level: level.toUpperCase() })} value={draft.preview_heading_fonts[level] || ''} fonts={fonts} inheritedFamily={draft.preview_font_family} fallback="Follow body" size={draft.preview_font_size * (draft.preview_heading_sizes[level] || size)} weight={draft.preview_heading_weights[level] || 600}
                      onChange={value => update('preview_heading_fonts', { ...draft.preview_heading_fonts, [level]: value })} />
                    <label>{t('Size (relative to body)')}<input type="number" min={0.5} max={5} step={0.05} value={draft.preview_heading_sizes[level] || size}
                      onChange={e => update('preview_heading_sizes', { ...draft.preview_heading_sizes, [level]: Math.max(0.5, Math.min(5, +e.target.value || size)) })} /></label>
                    <label>{t('Weight')}<select value={draft.preview_heading_weights[level] || 600} onChange={e => update('preview_heading_weights', { ...draft.preview_heading_weights, [level]: +e.target.value })}>
                      {[300, 400, 500, 600, 700, 800, 900].map(weight => <option key={weight} value={weight}>{weight}</option>)}
                    </select></label>
                  </div>)}
                  <FontField label={t("Quote font")} value={draft.preview_quote_font_family} fonts={fonts} inheritedFamily={draft.preview_font_family} fallback="Follow body" onChange={value => update('preview_quote_font_family', value)} />
                  <FontField label={t("Inline code font")} value={draft.preview_inline_code_font_family} fonts={fonts} inheritedFamily={draft.editor_font_family} fallback="Follow editor" onChange={value => update('preview_inline_code_font_family', value)} />
                  <FontField label={t("Code block font")} value={draft.preview_code_font_family} fonts={fonts} inheritedFamily={draft.editor_font_family} fallback="Follow editor" onChange={value => update('preview_code_font_family', value)} />
                </details>
                <div className={`${styles.readingSample} ${previewStyles.markdown}`} style={previewTypography(draft)}>
                  <h1>中文标题 · Heading 1</h1><h2>二级标题 · Heading 2</h2>
                  <h3>三级标题 · Heading 3</h3><h4>四级标题 · Heading 4</h4>
                  <h5>五级标题 · Heading 5</h5><h6>六级标题 · Heading 6</h6>
                  <p>中文正文与 English body text。<code>inline code</code></p>
                  <blockquote>引用文字 · A quiet thought.</blockquote><pre><code>const words = "你好";</code></pre>
                </div>
                <label> {t("Preview surface")} <select
                    value={draft.preview_paper}
                    onChange={e =>
                      update('preview_paper', e.target.value as 'light' | 'match')
                    }
                  >
                    <option value="light">{t("Paper (white)")}</option>
                    <option value="match">{t("Match app theme")}</option>
                  </select>
                </label>
                <p className={styles.hint}>{t('Light paper adapts the accent only when needed for readable contrast.')}</p>
                <label> {t("Reading width")} <select
                    value={draft.preview_reading_width}
                    onChange={e =>
                      update(
                        'preview_reading_width',
                        e.target.value as 'narrow' | 'medium' | 'wide',
                      )
                    }
                  >
                    <option value="narrow">{t("Narrow (~65 characters)")}</option>
                    <option value="medium">{t("Medium (~80 characters)")}</option>
                    <option value="wide">{t("Wide")}</option>
                  </select>
                </label>
              </section>
            )}

            {active === 'LaTeX & PDF' && (
              <>
                <section className={styles.section}>
                  <h3>LaTeX</h3>
                  <label> {t("Engine")} <select
                      value={draft.latex_engine}
                      onChange={e => update('latex_engine', e.target.value)}
                    >
                      {/* A hand-edited settings.json can hold an engine we do
                          not offer. Without this option React would show the
                          first entry as selected and Save would silently
                          rewrite the user's choice. */}
                      {isUnknownEngine(draft.latex_engine, LATEX_ENGINES) && (
                        <option value={draft.latex_engine}>
                          {draft.latex_engine} (from settings.json)
                        </option>
                      )}
                      {LATEX_ENGINES.map(name => (
                        <option key={name} value={name}>
                          {engineLabel(name, latexEngines)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <EngineStatus
                    result={latexEngines}
                    name={draft.latex_engine}
                    probing={probing}
                    known={!isUnknownEngine(draft.latex_engine, LATEX_ENGINES)}
                  />
                  <label> {t("Bibliography engine")} <select
                      value={draft.bib_engine}
                      onChange={e => update('bib_engine', e.target.value as Settings['bib_engine'])}
                    >
                      {/* Same hand-edit guard as the LaTeX engine above; 'auto'
                          and 'none' are valid non-executable choices. */}
                      {isUnknownEngine(draft.bib_engine, BIB_ENGINE_CHOICES) && (
                        <option value={draft.bib_engine}>
                          {draft.bib_engine} (from settings.json)
                        </option>
                      )}
                      <option value="auto">{t('Automatic')}</option>
                      {BIB_ENGINES.map(name => (
                        <option key={name} value={name}>
                          {engineLabel(name, bibEngines)}
                        </option>
                      ))}
                      <option value="none">{t('None')}</option>
                    </select>
                  </label>
                  {/* 'auto' resolves at compile time and 'none' skips the step,
                      so neither names a binary whose presence we could report. */}
                  {(BIB_ENGINES as readonly string[]).includes(draft.bib_engine) && (
                    <EngineStatus
                      result={bibEngines}
                      name={draft.bib_engine}
                      probing={probing}
                      known
                    />
                  )}
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => void detectEngines()}
                    disabled={probing || !hasTauri()}
                  >
                    {probing ? t("Detecting…") : t("Detect again")}
                  </button>
                  <label className={styles.inline}>
                    <input
                      type="checkbox"
                      checked={draft.auto_rerun}
                      onChange={e => update('auto_rerun', e.target.checked)}
                    /> {t("Auto rerun for cross-references")} </label>
                  <label> {t("Max runs")} <input
                      type="number"
                      min={1}
                      max={8}
                      value={draft.max_runs}
                      onChange={e => update('max_runs', Math.max(1, Math.min(8, +e.target.value || 1)))}
                    />
                  </label>
                </section>

                <section className={styles.section}>
                  <h3>{t("PDF Preview")}</h3>
                  <label> {t("Dark mode")} <select
                      value={draft.pdf_dark_mode}
                      onChange={e => update('pdf_dark_mode', e.target.value)}
                    >
                      <option value="off">{t("Off (white paper)")}</option>
                      <option value="invert">{t("Invert colors")}</option>
                      <option value="sepia">{t("Sepia")}</option>
                    </select>
                  </label>
                  <p className={styles.hint}>{t('Paper surroundings follow light or dark mode in neutral gray. Accent colors never tint the PDF.')}</p>
                </section>
              </>
            )}

            {active === 'Editor' && (
              <>
                <section className={styles.section}>
                  <h3>{t("Editor")}</h3>
                  <FontField label={t("Font family")} value={draft.editor_font_family} onChange={value => update('editor_font_family', value)} fonts={fonts} inheritedFamily={defaultSettings.editor_font_family} size={draft.editor_font_size} lineHeight={draft.editor_line_height} />
                  <label> {t("Font size")} <input
                      type="number"
                      min={8}
                      max={48}
                      value={draft.editor_font_size}
                      onChange={e => update('editor_font_size', Math.max(8, Math.min(48, +e.target.value || 16)))}
                    />
                  </label>
                  <label> {t("Line height")} <input
                      type="number"
                      min={1}
                      max={3}
                      step={0.05}
                      value={draft.editor_line_height}
                      onChange={e => update('editor_line_height', Math.max(1, Math.min(3, +e.target.value || 1.85)))}
                    />
                  </label>
                  <label> {t("Main text word limit (0 = off)")} <input type="number" min={0} value={draft.writing_main_word_limit} onChange={e => update('writing_main_word_limit', Math.max(0, +e.target.value || 0))} />
                  </label>
                  <label> {t("Abstract word limit (0 = off)")} <input type="number" min={0} value={draft.writing_abstract_word_limit} onChange={e => update('writing_abstract_word_limit', Math.max(0, +e.target.value || 0))} />
                  </label>
                  <label className={styles.inline}>
                    <input
                      type="checkbox"
                      checked={draft.editor_spellcheck}
                      onChange={e => update('editor_spellcheck', e.target.checked)}
                    /> {t("Enable browser spellcheck (English)")} </label>
                  <label className={styles.inline}>
                    <input
                      type="checkbox"
                      checked={draft.autosave_enabled}
                      onChange={e => update('autosave_enabled', e.target.checked)}
                    /> {t("Autosave open files to disk (every 30s)")} </label>
                  <label> {t("Tab size (spaces)")} <input
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
                    /> {t("Indent with spaces (uncheck for hard tabs)")} </label>
                </section>

                <section className={styles.section}>
                  <h3>{t("Editor color overrides")}</h3>
                  <p className={styles.hint}>{t('Use Follow theme to remove an override. Swatches show the current editor colors.')}</p>
                  <div className={styles.colorGrid}>
                    {(
                      [
                        ['bg', 'bg', 'Background'],
                        ['fg', 'fg', 'Foreground'],
                        ['gutter_bg', 'gutterBg', 'Gutter bg'],
                        ['gutter_fg', 'gutterFg', 'Gutter fg'],
                        ['active_bg', 'activeBg', 'Active line'],
                        ['cursor', 'cursor', 'Cursor'],
                        ['selection', 'selection', 'Selection'],
                      ] as const
                    ).map(([key, themeKey, label]) => (
                      <ColorField key={key} label={t(label)} value={draftTheme[themeKey]}
                        overridden={!!draft.editor_theme_overrides[key]}
                        onChange={value => update('editor_theme_overrides', { ...draft.editor_theme_overrides, [key]: value })}
                        onReset={() => {
                          const next = { ...draft.editor_theme_overrides };
                          delete next[key];
                          update('editor_theme_overrides', next);
                        }} />
                    ))}
                  </div>
                </section>
              </>
            )}

            {active === 'Updates' && (
              <section className={styles.section}>
                <h3>{t("Updates")}</h3>
                <p className={styles.hint}>
                  {version ? `Clavis v${version}` : 'Clavis'} · {t('Installed releases can update from GitHub.')}
                </p>
                <button
                  type="button"
                  className={styles.primary}
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => void checkForUpdates({ silent: false })}
                > {t("Check for Updates")} </button>
                <p className={styles.hint}> {t("Auto-update only works in an installed (released) build, not in dev mode.")} </p>
              </section>
            )}
          </div>
        </fieldset>
        {saveError && <p role="alert" className={styles.saveError}>{saveError}</p>}

        <footer className={styles.footer}>
          <button className={styles.secondary} onClick={onReset} disabled={saving || active === 'Updates'}>
            {t('Reset this category')}
          </button>
          <div className={styles.spacer} />
          <button className={styles.secondary} onClick={onClose} disabled={saving}> {t("Cancel")} </button>
          <button className={styles.primary} onClick={onSave} disabled={saving}>
            {saving ? t('Saving…') : t('Save')}
          </button>
        </footer>
      </section>
    </div>
  );
}

/// Resolved path and `--version` banner for the selected engine.
/// State logic lives in `describeEngineStatus` so it can be tested directly.
function EngineStatus({
  result,
  name,
  probing,
  known,
}: {
  result: ProbeResult;
  name: string;
  probing: boolean;
  known: boolean;
}) {
  if (!hasTauri()) return null;
  // An off-list engine is never probed, so any verdict about it would be
  // fabricated. Say where it came from instead.
  if (!known) {
    return (
      <p className={styles.hint}>
        {t('Custom engine from settings.json; passed to the compiler as-is.')}
      </p>
    );
  }
  const status = describeEngineStatus(result, name, probing);
  switch (status.kind) {
    case 'hidden':
      return null;
    case 'pending':
      return <p className={styles.hint}>{t("Detecting…")}</p>;
    case 'failed':
      return (
        <p className={styles.hint}>
          {t('Engine detection failed; installation status of {name} is unknown.', { name })}
        </p>
      );
    case 'missing':
      return (
        <p className={styles.hint}>
          {t('Engine not found. Install it or set a custom path in settings.json.')}
        </p>
      );
    case 'found':
      return (
        <p className={styles.hint}>
          <span className={styles.enginePath}>{status.path}</span>
          {status.version ? <>{' — '}{status.version}</> : t(' · version not reported')}
        </p>
      );
  }
}
