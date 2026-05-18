// Toolbar — header strip with language switcher, LaTeX/Typst-specific
// controls, and global file/settings buttons.
//
// Behaviour-wise this is the legacy <header class="toolbar"> in
// ui-legacy/index.html lines ~22-65 — but driven by props rather than DOM ids,
// so different tabs can swap their language without the toolbar caring.

import type { Lang } from '../store';
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

export function Toolbar(props: ToolbarProps) {
  const { lang, onLangChange } = props;

  return (
    <header className={styles.toolbar} data-tauri-drag-region>
      <div className={styles.brand} data-tauri-drag-region>Clavis</div>

      <div className={styles.langSwitch} data-tauri-drag-region>
        <label>Language:</label>
        <select value={lang} onChange={e => onLangChange(e.target.value as Lang)}>
          <option value="markdown">Markdown</option>
          <option value="latex">LaTeX</option>
          <option value="typst">Typst</option>
        </select>
      </div>

      {lang === 'latex' && (
        <div className={styles.latexControls}>
          <label className={styles.muted}>Engine:</label>
          <select
            value={props.latexEngine ?? 'pdflatex'}
            onChange={e => props.onLatexEngineChange?.(e.target.value)}
          >
            <option value="pdflatex">pdflatex</option>
            <option value="xelatex">xelatex</option>
            <option value="lualatex">lualatex</option>
          </select>
          <button className={styles.btn} onClick={props.onCompile} title="Compile (Ctrl+B)">
            Compile
          </button>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={props.autoCompile ?? false}
              onChange={e => props.onAutoCompileChange?.(e.target.checked)}
            />
            Auto
          </label>
          <button
            className={styles.btn}
            onClick={props.onSynctexForward}
            title="Jump to PDF (Ctrl+Alt+J)"
          >
            →PDF
          </button>
          <button
            className={styles.btn}
            onClick={props.onSetMain}
            title="Set current file as project main"
          >
            Set main
          </button>
          <button
            className={styles.btn}
            onClick={props.onExportLatexPdf}
            title="Export compiled PDF (Ctrl+Shift+E)"
          >
            Export PDF
          </button>
        </div>
      )}

      {lang === 'typst' && (
        <div className={styles.typstControls}>
          <button
            className={styles.btn}
            onClick={props.onExportTypstPdf}
            title="Export PDF (Ctrl+Shift+E)"
          >
            Export PDF
          </button>
        </div>
      )}

      <button className={styles.btn} onClick={props.onOpenFile} title="Open file (Ctrl+O)">
        Open
      </button>
      <button className={styles.btn} onClick={props.onOpenFolder} title="Open folder (Ctrl+Shift+O)">
        Open folder
      </button>
      <button className={styles.btn} onClick={props.onToggleRecent} title="Recent files">
        Recent ▾
      </button>
      <button className={styles.btn} onClick={props.onSave} title="Save (Ctrl+S)">
        Save
      </button>
      <button className={styles.btn} onClick={props.onToggleSymbols} title="Math symbols">
        ∑
      </button>
      <button
        className={styles.btn}
        onClick={props.onOpenCommandPalette}
        title="Command palette (Ctrl+Shift+P)"
      >
        ⌘P
      </button>
      <button className={styles.btn} onClick={props.onOpenSettings} title="Settings">
        Settings
      </button>

      <div className={`${styles.status} ${props.statusKind ? styles[props.statusKind] : ''}`} data-tauri-drag-region>
        {props.status ?? 'Ready'}
      </div>
      {props.statusMeta && <div className={styles.statusMeta} data-tauri-drag-region>{props.statusMeta}</div>}
    </header>
  );
}
