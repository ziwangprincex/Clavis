// Toolbar — macOS-style unified title bar: language segmented control,
// contextual compile controls, icon buttons, and a status capsule.
//
// The whole strip is a Tauri drag region (window can be moved by grabbing
// empty space); every interactive control opts out via CSS
// `-webkit-app-region: no-drag` on its class.

import type { Lang } from '../store';
import {
  IconClock,
  IconCommand,
  IconDoc,
  IconExport,
  IconFolder,
  IconGear,
  IconPin,
  IconPlay,
  IconSave,
  IconSigma,
  IconTarget,
} from './icons';
import styles from './Toolbar.module.css';

export interface ToolbarProps {
  lang: Lang;
  onLangChange: (lang: Lang) => void;

  latexEngine?: string;
  onLatexEngineChange?: (engine: string) => void;
  autoCompile?: boolean;
  onAutoCompileChange?: (v: boolean) => void;
  onCompile?: () => void;
  onSynctexForward?: () => void;
  onSetMain?: () => void;
  onExportLatexPdf?: () => void;

  onExportTypstPdf?: () => void;

  onOpenFile?: () => void;
  onOpenFolder?: () => void;
  onSave?: () => void;
  onOpenSettings?: () => void;
  onToggleSymbols?: () => void;
  onOpenCommandPalette?: () => void;
  onToggleRecent?: () => void;

  status?: string;
  statusKind?: 'info' | 'ok' | 'error';
  statusMeta?: string;
}

const LANGS: { value: Lang; label: string }[] = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'latex', label: 'LaTeX' },
  { value: 'typst', label: 'Typst' },
];

export function Toolbar(props: ToolbarProps) {
  const { lang, onLangChange } = props;

  return (
    <header className={styles.toolbar} data-tauri-drag-region>
      <div className={styles.brand} data-tauri-drag-region>
        Clavis
      </div>

      {/* Language switcher — macOS segmented control */}
      <div className={styles.segmented} role="tablist" aria-label="Language">
        {LANGS.map(l => (
          <button
            key={l.value}
            role="tab"
            aria-selected={lang === l.value}
            className={`${styles.segment} ${lang === l.value ? styles.segmentActive : ''}`}
            onClick={() => onLangChange(l.value)}
          >
            {l.label}
          </button>
        ))}
      </div>

      {lang === 'latex' && (
        <div className={styles.group}>
          <select
            className={styles.select}
            value={props.latexEngine ?? 'pdflatex'}
            onChange={e => props.onLatexEngineChange?.(e.target.value)}
            title="LaTeX engine"
          >
            <option value="pdflatex">pdflatex</option>
            <option value="xelatex">xelatex</option>
            <option value="lualatex">lualatex</option>
          </select>

          <button className={styles.primaryBtn} onClick={props.onCompile} title="Compile (⌘B)">
            <IconPlay size={12} />
            <span>Compile</span>
          </button>

          <label className={styles.switchWrap} title="Recompile automatically while typing">
            <span
              className={`${styles.switch} ${props.autoCompile ? styles.switchOn : ''}`}
              role="switch"
              aria-checked={props.autoCompile ?? false}
              tabIndex={0}
              onClick={() => props.onAutoCompileChange?.(!props.autoCompile)}
              onKeyDown={e => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  props.onAutoCompileChange?.(!props.autoCompile);
                }
              }}
            >
              <span className={styles.knob} />
            </span>
            <span className={styles.switchLabel}>Auto</span>
          </label>

          <span className={styles.divider} />

          <button
            className={styles.iconBtn}
            onClick={props.onSynctexForward}
            title="Jump to PDF (⌘⌥J)"
          >
            <IconTarget />
          </button>
          <button
            className={styles.iconBtn}
            onClick={props.onSetMain}
            title="Set current file as project main"
          >
            <IconPin />
          </button>
          <button
            className={styles.iconBtn}
            onClick={props.onExportLatexPdf}
            title="Export compiled PDF (⌘⇧E)"
          >
            <IconExport />
          </button>
        </div>
      )}

      {lang === 'typst' && (
        <div className={styles.group}>
          <button
            className={styles.iconBtn}
            onClick={props.onExportTypstPdf}
            title="Export PDF (⌘⇧E)"
          >
            <IconExport />
          </button>
        </div>
      )}

      <div className={styles.spacer} data-tauri-drag-region />

      <div
        className={`${styles.statusCapsule} ${props.statusKind ? styles[props.statusKind] : ''}`}
        data-tauri-drag-region
      >
        <span className={styles.statusDot} />
        <span className={styles.statusText}>{props.status ?? 'Ready'}</span>
        {props.statusMeta && <span className={styles.statusMeta}>{props.statusMeta}</span>}
      </div>

      <span className={styles.divider} />

      <div className={styles.group}>
        <button className={styles.iconBtn} onClick={props.onOpenFile} title="Open file (⌘O)">
          <IconDoc />
        </button>
        <button
          className={styles.iconBtn}
          onClick={props.onOpenFolder}
          title="Open folder (⌘⇧O)"
        >
          <IconFolder />
        </button>
        <button className={styles.iconBtn} onClick={props.onToggleRecent} title="Recent files">
          <IconClock />
        </button>
        <button className={styles.iconBtn} onClick={props.onSave} title="Save (⌘S)">
          <IconSave />
        </button>
        <button className={styles.iconBtn} onClick={props.onToggleSymbols} title="Math symbols">
          <IconSigma />
        </button>
        <button
          className={styles.iconBtn}
          onClick={props.onOpenCommandPalette}
          title="Command palette (⌘⇧P)"
        >
          <IconCommand />
        </button>
        <button className={styles.iconBtn} onClick={props.onOpenSettings} title="Settings">
          <IconGear />
        </button>
      </div>
    </header>
  );
}
