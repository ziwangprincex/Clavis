import { t } from '../i18n';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTabsStore, useCompileStore, usePdfStore, useSettingsStore, type Lang, type EditorLayout } from '../store';
import { fmtShortcut } from '../platform';
import { belongsToPdf } from '../compile/target';
import { isLatexError } from '../store/compile';
import { LATEX_ENGINES, isUnknownEngine } from './engineStatus';
import {
  IconClock, IconCommandPalette, IconDoc, IconExport,
  IconFolder, IconGear, IconPin, IconSave, IconSigma, IconTarget,
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
  onStopCompile?: () => void;
  onQuickCompile?: () => void;
  onCleanCompile?: () => void;
  onFullCompile?: () => void;
  onSynctexForward?: () => void;
  onSetMain?: () => void;
  onExportLatexPdf?: () => void;
  onExportTypstPdf?: () => void;
  onExportHtml?: () => void;
  onOpenFile?: () => void;
  onOpenFolder?: () => void;
  onSave?: () => void;
  onOpenSettings?: () => void;
  onToggleSymbols?: () => void;
  onOpenCommandPalette?: () => void;
  onToggleRecent?: () => void;
  onWriterTool?: (tool: 'templates' | 'history' | 'environment') => void;
  onNewDocument?: () => void;
  inlineMath?: boolean;
  onInlineMathChange?: (enabled: boolean) => void;
  /** The document's status (word count, compile state, messages), shown at the right. */
  status?: ReactNode;
}

export function Toolbar(props: ToolbarProps) {
  const { lang, onLangChange } = props;
  const tab = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const name = tab ? tab.filePath?.split(/[\\/]/).pop() || t('Untitled') : 'Clavis';
  const compiling = useCompileStore(s => s.status === 'compiling');
  const errorCount = useCompileStore(s => s.errors.filter(diag => isLatexError(diag.kind)).length);
  const pdf = usePdfStore();
  const canExport = !!tab && (lang === 'typst' || (!!pdf.bytes && !!pdf.workdirToken && !pdf.stale && belongsToPdf(tab, pdf) && !compiling));
  const [menu, setMenu] = useState<'document' | null>(null);
  const engine = props.latexEngine ?? 'pdflatex';
  const markdownSource = useSettingsStore(s => s.settings.markdown_source_mode);
  const typewriter = useSettingsStore(s => s.settings.editor_typewriter);
  useEffect(() => { setMenu(null); }, [lang, tab?.id]);

  const latex = lang === 'latex';
  const typeset = lang !== 'markdown';
  return (
    <header className={styles.toolbar} data-tauri-drag-region>
      <button className={`${styles.iconBtn} ${props.sidebarVisible ? styles.pressed : ''}`} onClick={props.onToggleSidebar} aria-label={t('Toggle sidebar')} aria-pressed={props.sidebarVisible} title={`${t('Toggle sidebar')} (${fmtShortcut('Ctrl+Shift+L')})`}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" /><path d="M6 3v10" /></svg>
      </button>
      {/* Always on the bar: once a project is open, the first-run actions are gone. */}
      <button className={styles.iconBtn} onClick={props.onNewDocument} aria-label={t('New document')} title={`${t('New document')} (${fmtShortcut('Ctrl+N')})`}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 1.75H4.25a.5.5 0 0 0-.5.5v11.5a.5.5 0 0 0 .5.5h7.5a.5.5 0 0 0 .5-.5V5L9 1.75Z" /><path d="M9 1.9V5h3.1M8 7.5v4M6 9.5h4" /></svg>
      </button>
      <div className={styles.identity} data-tauri-drag-region>
        <span className={styles.documentName} title={tab?.filePath ?? name} data-tauri-drag-region>{name}</span>
        {tab?.isDirty && <span className={styles.dirty} aria-label={t('Unsaved changes')} title={t('Unsaved changes')} />}
      </div>
      <div className={styles.actions}>
        {/* Word count, compile state and messages (StatusBar), where the eye already is. */}
        {props.status}
        {latex && (
          <button className={styles.primaryBtn} aria-label={compiling ? t('Stop compilation') : t('Compile')} aria-busy={compiling} onClick={compiling ? props.onStopCompile : props.onCompile} title={`${t('Compile')} (${fmtShortcut('Ctrl+B')})`}>
            <span className={styles.actionLabel}>{compiling ? t('Stop') : t('Compile')}</span>
            {!compiling && <kbd className={styles.keys}>{fmtShortcut('Ctrl+B')}</kbd>}
            {!compiling && errorCount > 0 && <span className={styles.errorCount} aria-label={t('{count} issues', { count: errorCount })}>{errorCount}</span>}
          </button>
        )}
        {/* Markdown is edited formatted in place; only typeset output needs a second pane. */}
        {typeset && <div className={styles.layoutSwitch} role="group" aria-label={t('Editor layout')}>
          {(['editor', 'split', 'preview'] as const).map((mode, i) => {
            const label = mode === 'editor' ? t('Editor only') : mode === 'preview' ? t('Preview only') : t('Split view');
            return (
              <button key={mode} className={props.layout === mode ? styles.selectedLayout : ''} onClick={() => props.onLayoutChange(mode)} aria-pressed={props.layout === mode} aria-label={label} title={`${label} (${fmtShortcut(`Ctrl+${i + 2}`)})`}>
                <LayoutIcon mode={mode} />
              </button>
            );
          })}
        </div>}
        <ToolbarMenu label={t('Document tools')} open={menu === 'document'} onToggle={() => setMenu(menu === 'document' ? null : 'document')} onClose={() => setMenu(null)} icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></svg>}>
          {run => <>
            <div className={styles.menuHeading}>{t('Document')}</div>
            <button className={styles.menuItem} onClick={() => run(props.onNewDocument)}><IconDoc aria-hidden="true" />{t('New document')}<kbd>{fmtShortcut('Ctrl+N')}</kbd></button>
            <button className={styles.menuItem} onClick={() => run(() => props.onWriterTool?.('templates'))}><IconDoc aria-hidden="true" />{t('New from template…')}</button>
            <button className={styles.menuItem} onClick={() => run(props.onOpenFile)}><IconDoc aria-hidden="true" />{t('Open file')}<kbd>{fmtShortcut('Ctrl+O')}</kbd></button>
            <button className={styles.menuItem} onClick={() => run(props.onOpenFolder)}><IconFolder aria-hidden="true" />{t('Open folder')}</button>
            <button className={styles.menuItem} onClick={() => run(props.onToggleRecent)}><IconClock aria-hidden="true" />{t('Recent files')}</button>
            <button className={styles.menuItem} disabled={!tab} onClick={() => run(props.onSave)}><IconSave aria-hidden="true" />{t('Save')}<kbd>{fmtShortcut('Ctrl+S')}</kbd></button>
            <button className={styles.menuItem} disabled={!tab} onClick={() => run(() => props.onWriterTool?.('history'))}>{t('Local version timeline…')}</button>
            {typeset
              ? <button className={styles.menuItem} disabled={!canExport} title={canExport ? undefined : t('Compile to export PDF')} onClick={() => run(latex ? props.onExportLatexPdf : props.onExportTypstPdf)}><IconExport aria-hidden="true" />{t('Export PDF')}<kbd>{fmtShortcut('Ctrl+Shift+E')}</kbd></button>
              : <button className={styles.menuItem} disabled={!tab} onClick={() => run(props.onExportHtml)}><IconExport aria-hidden="true" />{t('Export HTML…')}<kbd>{fmtShortcut('Ctrl+Shift+E')}</kbd></button>}
            {typeset && <>
              <div className={styles.menuHeading}>{t('Typesetting')}</div>
              {latex && <>
                <label className={styles.optionRow}><span>{t('Engine')}</span>
                  <select value={engine} onChange={event => props.onLatexEngineChange?.(event.target.value)}>
                    {isUnknownEngine(engine, LATEX_ENGINES) && <option value={engine}>{engine}</option>}
                    {LATEX_ENGINES.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className={styles.optionRow}><span>{t('Compile automatically')}</span><input type="checkbox" checked={props.autoCompile ?? false} onChange={event => props.onAutoCompileChange?.(event.target.checked)} /></label>
              </>}
              <button className={styles.menuItem} onClick={() => run(props.onSynctexForward)}><IconTarget aria-hidden="true" />{latex ? t('Jump to PDF') : t('Jump to preview')}</button>
              <button className={styles.menuItem} disabled={!tab?.filePath} onClick={() => run(props.onSetMain)}><IconPin aria-hidden="true" />{t('Set as project main')}</button>
              {latex && <>
                <button className={styles.menuItem} onClick={() => run(() => props.onWriterTool?.('environment'))}>{t('Check environment…')}</button>
                <details className={styles.advanced}>
                  <summary>{t('Build options')}</summary>
                  <button className={styles.menuItem} onClick={() => run(props.onQuickCompile)}>{t('Quick preview · one pass')}</button>
                  <button className={styles.menuItem} onClick={() => run(props.onCleanCompile)}>{t('Clean rebuild')}</button>
                  <button className={styles.menuItem} onClick={() => run(props.onFullCompile)}>{t('Full build · latexmk')}</button>
                </details>
              </>}
            </>}
            {tab && <>
              <div className={styles.menuHeading}>{t('Writing')}</div>
              <label className={styles.optionRow}><span>{t('Language')}</span>
                <select value={lang} onChange={event => onLangChange(event.target.value as Lang)}>
                  <option value="markdown">Markdown</option><option value="latex">LaTeX</option><option value="typst">Typst</option>
                </select>
              </label>
              {lang === 'markdown'
                ? <label className={styles.optionRow}><span>{t('Show Markdown source')}<kbd>{fmtShortcut('Ctrl+/')}</kbd></span><input type="checkbox" checked={markdownSource} onChange={event => void useSettingsStore.getState().patchAndSave({ markdown_source_mode: event.target.checked })} /></label>
                : <label className={styles.optionRow}><span>{t('Formulas in text')}</span><input type="checkbox" checked={props.inlineMath ?? false} onChange={event => props.onInlineMathChange?.(event.target.checked)} /></label>}
              <label className={styles.optionRow}><span>{t('Focus mode')}<kbd>{fmtShortcut('Ctrl+Shift+Enter')}</kbd></span><input type="checkbox" checked={props.focusMode} onChange={() => run(props.onToggleFocus)} /></label>
              <label className={styles.optionRow}><span>{t('Typewriter scrolling')}</span><input type="checkbox" checked={typewriter} onChange={event => void useSettingsStore.getState().patchAndSave({ editor_typewriter: event.target.checked })} /></label>
              <button className={styles.menuItem} onClick={() => run(props.onToggleSymbols)}><IconSigma aria-hidden="true" />{t('Math symbols')}</button>
            </>}
            <div className={styles.menuHeading}>Clavis</div>
            <button className={styles.menuItem} onClick={() => run(props.onOpenCommandPalette)}><IconCommandPalette aria-hidden="true" />{t('Command palette')}</button>
            <button className={styles.menuItem} onClick={() => run(props.onOpenSettings)}><IconGear aria-hidden="true" />{t('Settings')}</button>
          </>}
        </ToolbarMenu>
      </div>
    </header>
  );
}

/** Write, Split and Read as pictures of the window: a page, two panes, a book. */
function LayoutIcon({ mode }: { mode: EditorLayout }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" aria-hidden="true">
      {mode === 'editor' && <><rect x="3" y="2" width="10" height="12" rx="1.5" /><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" /></>}
      {mode === 'split' && <><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" /><path d="M8 3v10" /></>}
      {mode === 'preview' && <path d="M8 4.2C6.6 3.2 4.6 2.8 2 3v9.3c2.6-.2 4.6.2 6 1.2 1.4-1 3.4-1.4 6-1.2V3c-2.6-.2-4.6.2-6 1.2Zm0 0v9.3" />}
    </svg>
  );
}


function ToolbarMenu({ label, icon, open, onToggle, onClose, children }: {
  label: string; icon: ReactNode; open: boolean; onToggle: () => void; onClose: () => void;
  children: (run: (action?: () => void) => void) => ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); onClose(); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, onClose]);
  return <div ref={container} className={styles.disclosure} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) onClose();
  }}>
    <button ref={trigger} className={`${styles.iconBtn} ${open ? styles.pressed : ''}`} aria-label={label} title={label} aria-expanded={open} aria-controls={id} onClick={onToggle}>{icon}</button>
    {open && <div id={id} className={styles.popover} aria-label={label}>
      {children(action => { onClose(); trigger.current?.focus(); action?.(); })}
    </div>}
  </div>;
}
