// A quiet document toolbar. Secondary actions live in a keyboard-accessible
// disclosure rather than competing with the document and compile action.
import { useEffect, useId, useRef, useState } from 'react';
import { useTabsStore, useCompileStore, type Lang, type EditorLayout } from '../store';
import { fmtShortcut } from '../platform';
import {
  IconClock, IconCommand, IconDoc, IconExport,
  IconFolder, IconGear, IconPin, IconPlay, IconSave, IconSigma, IconTarget,
} from './icons';
import styles from './Toolbar.module.css';

export interface ToolbarProps {
  focusMode: boolean;
  onToggleFocus: () => void;
  layout: EditorLayout;
  onLayoutChange: (layout: EditorLayout) => void;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
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
}

export function Toolbar(props: ToolbarProps) {
  const { lang, onLangChange } = props;
  const tab = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const name = tab?.filePath?.split(/[\\/]/).pop() || 'Untitled';
  const compiling = useCompileStore(s => s.status === 'compiling');
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!disclosure.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  function run(action?: () => void) {
    setOpen(false);
    trigger.current?.focus();
    action?.();
  }

  return (
    <header className={styles.toolbar} data-tauri-drag-region>
      <button className={`${styles.iconBtn} ${props.sidebarVisible ? styles.pressed : ''}`} onClick={props.onToggleSidebar} aria-label="Toggle sidebar" aria-pressed={props.sidebarVisible} title="Toggle sidebar">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M6 3v10" /></svg>
      </button>
      <button className={`${styles.iconBtn} ${styles.optionalAction}`} onClick={props.onOpenFile} aria-label="Open file" title={`Open file (${fmtShortcut('Ctrl+O')})`}><IconFolder aria-hidden="true" /></button>
      <div className={styles.identity} data-tauri-drag-region>
        <span className={styles.documentName} title={tab?.filePath ?? name} data-tauri-drag-region>{name}</span>
        {tab?.isDirty && <span className={styles.dirty} aria-label="Unsaved changes" title="Unsaved changes" />}
      </div>
      <div className={styles.actions}>
        <button className={`${styles.iconBtn} ${styles.optionalAction}`} onClick={props.onSave} aria-label="Save document" title={`Save (${fmtShortcut('Ctrl+S')})`} disabled={!tab}><IconSave aria-hidden="true" /></button>
        <div className={styles.layoutSwitch} role="group" aria-label="Editor layout">
          {(['editor', 'split', 'preview'] as const).map(mode => (
            <button key={mode} className={props.layout === mode ? styles.selectedLayout : ''} onClick={() => props.onLayoutChange(mode)} aria-pressed={props.layout === mode} title={mode === 'editor' ? 'Editor only' : mode === 'preview' ? 'Preview only' : 'Split view'}>
              {mode === 'editor' ? 'Write' : mode === 'preview' ? 'Read' : 'Split'}
            </button>
          ))}
        </div>
        <button className={`${styles.iconBtn} ${props.focusMode ? styles.pressed : ''}`} onClick={props.onToggleFocus} aria-label={props.focusMode ? 'Leave focus mode' : 'Focus mode'} aria-pressed={props.focusMode} title={`Focus mode (${fmtShortcut('Ctrl+Shift+Enter')})`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" /></svg>
        </button>
        {lang === 'latex' && (
          <button className={styles.primaryBtn} aria-label="Compile" disabled={compiling} aria-busy={compiling} onClick={props.onCompile} title={`Compile (${fmtShortcut('Ctrl+B')})`}>
            <IconPlay size={14} aria-hidden="true" /><span className={styles.actionLabel}>{compiling ? 'Typesetting…' : 'Compile'}</span>
          </button>
        )}
        <div className={styles.disclosure} ref={disclosure} onBlur={event => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
        }}>
          <button ref={trigger} className={`${styles.textBtn} ${open ? styles.pressed : ''}`} aria-label="Document tools" title="Document tools" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><circle cx="3" cy="9" r="1.3"/><circle cx="9" cy="9" r="1.3"/><circle cx="15" cy="9" r="1.3"/></svg>
          </button>
          {open && (
            <div className={styles.popover} id={panelId} aria-label="Document tools">
              <div className={styles.menuHeading}>Document</div>
              <label className={styles.optionRow}>
                <span>Language</span>
                <select value={lang} onChange={event => onLangChange(event.target.value as Lang)}>
                  <option value="markdown">Markdown</option>
                  <option value="latex">LaTeX</option>
                  <option value="typst">Typst</option>
                </select>
              </label>
              <button className={styles.menuItem} onClick={() => run(props.onOpenFile)}><IconDoc aria-hidden="true" />Open file<kbd>{fmtShortcut('Ctrl+O')}</kbd></button>
              <button className={styles.menuItem} onClick={() => run(props.onOpenFolder)}><IconFolder aria-hidden="true" />Open folder</button>
              <button className={styles.menuItem} onClick={() => run(props.onToggleRecent)}><IconClock aria-hidden="true" />Recent files</button>
              <button className={styles.menuItem} onClick={() => run(props.onSave)}><IconSave aria-hidden="true" />Save<kbd>{fmtShortcut('Ctrl+S')}</kbd></button>
              {lang === 'latex' && (
                <>
                  <div className={styles.menuHeading}>Typesetting</div>
                  <label className={styles.optionRow}>
                    <span>Engine</span>
                    <select value={props.latexEngine ?? 'pdflatex'} onChange={event => props.onLatexEngineChange?.(event.target.value)}>
                      <option value="pdflatex">pdflatex</option>
                      <option value="xelatex">xelatex</option>
                      <option value="lualatex">lualatex</option>
                    </select>
                  </label>
                  <label className={styles.optionRow}><span>Compile automatically</span><input type="checkbox" checked={props.autoCompile ?? false} onChange={event => props.onAutoCompileChange?.(event.target.checked)} /></label>
                  <button className={styles.menuItem} onClick={() => run(props.onSynctexForward)}><IconTarget aria-hidden="true" />Jump to PDF</button>
                  <button className={styles.menuItem} onClick={() => run(props.onSetMain)}><IconPin aria-hidden="true" />Set as project main</button>
                </>
              )}
              {lang !== 'markdown' && <button className={styles.menuItem} onClick={() => run(lang === 'latex' ? props.onExportLatexPdf : props.onExportTypstPdf)}><IconExport aria-hidden="true" />Export PDF<kbd>{fmtShortcut('Ctrl+Shift+E')}</kbd></button>}
              <div className={styles.menuHeading}>Workspace</div>
              <button className={styles.menuItem} onClick={() => run(props.onOpenCommandPalette)}><IconCommand aria-hidden="true" />Command palette</button>
              <button className={styles.menuItem} onClick={() => run(props.onToggleSymbols)}><IconSigma aria-hidden="true" />Math symbols</button>
              <button className={styles.menuItem} onClick={() => run(props.onOpenSettings)}><IconGear aria-hidden="true" />Settings</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
