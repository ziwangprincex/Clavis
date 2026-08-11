import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore, defaultSettings } from '../store';
import type { Settings } from '../store/settings';
import { BUILTIN_THEMES } from '../editor/controller';
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
  const patchAndSave = useSettingsStore(s => s.patchAndSave);
  const [draft, setDraft] = useState<Settings>(stored);
  const [active, setActive] = useState<Category>('Appearance');
  const [version, setVersion] = useState<string>('');
  const [latexEngines, setLatexEngines] = useState<ProbeResult>(null);
  const [bibEngines, setBibEngines] = useState<ProbeResult>(null);
  const [probing, setProbing] = useState(false);
  // Generation gate: a slow probe resolving after the dialog reopened (or after
  // a newer Detect again) must not overwrite fresher state.
  const probeGeneration = useRef(0);

  useEffect(() => {
    if (open) setDraft(stored);
  }, [open, stored]);

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
          <nav className={styles.nav} aria-label="Settings categories">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                type="button"
                className={`${styles.navItem} ${active === cat ? styles.navItemActive : ''}`}
                aria-current={active === cat ? 'page' : undefined}
                onClick={() => setActive(cat)}
              >
                {cat}
              </button>
            ))}
          </nav>

          <div className={styles.pane}>
            {active === 'Appearance' && (
              <section className={styles.section}>
                <h3>Appearance</h3>
                <label>
                  Theme
                  <select
                    value={draft.editor_theme}
                    onChange={e => update('editor_theme', e.target.value)}
                  >
                    <option value="auto">Auto (follow system)</option>
                    {Object.entries(BUILTIN_THEMES).map(([key, spec]) => (
                      <option key={key} value={key}>
                        {spec.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.hint}>
                  The chosen theme colors the whole window — editor, sidebar, and preview.
                </p>
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
            )}

            {active === 'Preview' && (
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
                <label>
                  Preview surface
                  <select
                    value={draft.preview_paper}
                    onChange={e =>
                      update('preview_paper', e.target.value as 'light' | 'match')
                    }
                  >
                    <option value="light">Paper (white)</option>
                    <option value="match">Match app theme</option>
                  </select>
                </label>
                <label>
                  Reading width
                  <select
                    value={draft.preview_reading_width}
                    onChange={e =>
                      update(
                        'preview_reading_width',
                        e.target.value as 'narrow' | 'medium' | 'wide',
                      )
                    }
                  >
                    <option value="narrow">Narrow (~65 characters)</option>
                    <option value="medium">Medium (~80 characters)</option>
                    <option value="wide">Wide</option>
                  </select>
                </label>
              </section>
            )}

            {active === 'LaTeX & PDF' && (
              <>
                <section className={styles.section}>
                  <h3>LaTeX</h3>
                  <label>
                    Engine
                    <select
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
                  <label>
                    Bibliography engine
                    <select
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
                      <option value="auto">auto</option>
                      {BIB_ENGINES.map(name => (
                        <option key={name} value={name}>
                          {engineLabel(name, bibEngines)}
                        </option>
                      ))}
                      <option value="none">none</option>
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
                    {probing ? 'Detecting…' : 'Detect again'}
                  </button>
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
              </>
            )}

            {active === 'Editor' && (
              <>
                <section className={styles.section}>
                  <h3>Editor</h3>
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
                  <label>
                    Main text word limit (0 = off)
                    <input type="number" min={0} value={draft.writing_main_word_limit} onChange={e => update('writing_main_word_limit', Math.max(0, +e.target.value || 0))} />
                  </label>
                  <label>
                    Abstract word limit (0 = off)
                    <input type="number" min={0} value={draft.writing_abstract_word_limit} onChange={e => update('writing_abstract_word_limit', Math.max(0, +e.target.value || 0))} />
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
              </>
            )}

            {active === 'Updates' && (
              <section className={styles.section}>
                <h3>Updates</h3>
                <p className={styles.hint}>
                  {version ? `Clavis v${version}` : 'Clavis'} — installed apps can update
                  themselves from GitHub releases.
                </p>
                <button
                  type="button"
                  className={styles.primary}
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => void checkForUpdates({ silent: false })}
                >
                  Check for Updates
                </button>
                <p className={styles.hint}>
                  Auto-update only works in an installed (released) build, not in dev mode.
                </p>
              </section>
            )}
          </div>
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
        Set in <code>settings.json</code>; not probed. Clavis will pass it to the
        compiler as-is.
      </p>
    );
  }
  const status = describeEngineStatus(result, name, probing);
  switch (status.kind) {
    case 'hidden':
      return null;
    case 'pending':
      return <p className={styles.hint}>Detecting…</p>;
    case 'failed':
      return (
        <p className={styles.hint}>
          Detection failed, so installed engines are unknown. This says nothing
          about whether {name} is present.
        </p>
      );
    case 'missing':
      return (
        <p className={styles.hint}>
          Not found on PATH. Compilation will fail until it is installed, or set
          a custom path in <code>settings.json</code>.
        </p>
      );
    case 'found':
      return (
        <p className={styles.hint}>
          <span className={styles.enginePath}>{status.path}</span>
          {status.version ? <>{' — '}{status.version}</> : ' — version not reported'}
        </p>
      );
  }
}
