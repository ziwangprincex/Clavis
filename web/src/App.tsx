import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { hasTauri, dialogOpen, dialogSave, dialogConfirm } from './api/tauri';
import { useSettingsStore, useTabsStore, useProjectStore, type Lang, newTabId } from './store';
import { useCommandsStore } from './store/commands';
import { Toolbar } from './components/Toolbar';
import { CommandPalette } from './components/CommandPalette';
import { SettingsDialog } from './components/SettingsDialog';
import { LogPanel } from './components/LogPanel';
import { Tabs } from './components/Tabs';
import { Sidebar } from './components/Sidebar';
import { OutlineSection } from './components/OutlineSection';
import { FolderTreeSection } from './components/FolderTreeSection';
import { FilesSection } from './components/FilesSection';
import { BibSection } from './components/BibSection';
import type { EditorPaneRef } from './components/EditorPane';
import { runLatexCompile } from './compile/latex';
import { syncTexBackwardFromPdf, syncTexForwardFromEditor } from './compile/synctex';
import { openFileDialog, openFileByPath, saveActiveTab } from './files/files';
import { restoreSession } from './files/session';
import { useAppTheme } from './hooks/useAppTheme';
import { useSessionPersistence } from './hooks/useSessionPersistence';
import { useFileDrop } from './hooks/useFileDrop';
import { usePaneLayout } from './hooks/usePaneLayout';
import { ipc } from './api/tauri';
import { SAMPLES } from './samples/samples';
import { SymbolsPanel } from './components/SymbolsPanel';
import { RecentMenu } from './components/RecentMenu';
import { Splitter } from './components/Splitter';
import { ErrorBoundary } from './components/ErrorBoundary';
import styles from './App.module.css';

// Lazy-loaded — these pull in CodeMirror 6 (~590KB) and pdfjs-dist (~410KB)
// respectively. Splitting them out lets the app's main shell (toolbar, tabs,
// sidebar) appear ~10× faster on first launch; the heavy chunks are fetched
// in parallel and ready by the time the user actually clicks into them.
const EditorPane = lazy(() =>
  import('./components/EditorPane').then(m => ({ default: m.EditorPane })),
);
const PreviewPane = lazy(() =>
  import('./components/PreviewPane').then(m => ({ default: m.PreviewPane })),
);
const PdfViewer = lazy(() =>
  import('./components/PdfViewer').then(m => ({ default: m.PdfViewer })),
);

export function App() {
  const loadSettings = useSettingsStore(s => s.load);
  const settings = useSettingsStore(s => s.settings);
  const patchAndSave = useSettingsStore(s => s.patchAndSave);

  const tabs = useTabsStore(s => s.tabs);
  const activeTabId = useTabsStore(s => s.activeTabId);
  const addTab = useTabsStore(s => s.addTab);
  const activeTab = tabs.find(t => t.id === activeTabId);
  const lang: Lang = activeTab?.lang ?? 'markdown';

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [autoCompile, setAutoCompile] = useState(true);
  const [statusText, setStatusText] = useState<string>('Ready');
  const [statusKind, setStatusKind] = useState<'info' | 'ok' | 'error'>('info');

  const editorApiRef = useRef<EditorPaneRef | null>(null);
  const autoCompileTimerRef = useRef<number | null>(null);

  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(null);
  const [folderRefreshKey, setFolderRefreshKey] = useState(0);

  // Pane widths + drag handlers (owns mainRef / workAreaRef).
  const {
    mainRef,
    workAreaRef,
    sidebarWidth,
    editorWidth,
    startSidebarDrag,
    dragSidebar,
    endSidebarDrag,
    startEditorDrag,
    dragEditor,
    endEditorDrag,
  } = usePaneLayout(settings);

  // Apply UI theme / fonts / accent / color overrides to :root.
  useAppTheme(settings);

  // Boot: load persisted settings, then restore the previous session (crash
  // recovery). Only if there's nothing to restore do we seed sample tabs.
  useEffect(() => {
    if (hasTauri()) loadSettings();
    if (useTabsStore.getState().tabs.length > 0) return;

    function seedSampleTabs() {
      const mdId = newTabId();
      const texId = newTabId();
      const typId = newTabId();
      const seedTabs = useTabsStore.getState();
      // Add all three; the last addTab call sets activeTabId, so we then
      // override to make Markdown the visible one.
      seedTabs.addTab({
        id: mdId,
        title: 'Welcome.md',
        filePath: null,
        lang: 'markdown',
        content: SAMPLES.markdown,
        isDirty: false,
      });
      seedTabs.addTab({
        id: texId,
        title: 'Welcome.tex',
        filePath: null,
        lang: 'latex',
        content: SAMPLES.latex,
        isDirty: false,
      });
      seedTabs.addTab({
        id: typId,
        title: 'Welcome.typ',
        filePath: null,
        lang: 'typst',
        content: SAMPLES.typst,
        isDirty: false,
      });
      seedTabs.setActive(mdId);
    }

    void (async () => {
      const restored = hasTauri() ? await restoreSession() : false;
      if (!restored && useTabsStore.getState().tabs.length === 0) {
        seedSampleTabs();
      }
    })();
  }, [loadSettings, addTab]);

  // Persist session (debounced) on tab changes + flush on unload; manage the
  // opt-in disk-autosave interval.
  useSessionPersistence(settings.autosave_enabled);

  // OS file-drop: files open, folders become the workspace.
  useFileDrop(setWorkspaceFolder);

  async function openFolder() {
    if (!hasTauri()) return;
    try {
      const result = await dialogOpen({ directory: true, multiple: false });
      if (typeof result === 'string') {
        setWorkspaceFolder(result);
      }
    } catch (e) {
      console.error('open folder failed', e);
    }
  }

  function setLang(next: Lang) {
    if (!activeTab) return;
    useTabsStore.getState().patchTab(activeTab.id, { lang: next });
  }

  async function compileNow() {
    if (!hasTauri()) return;
    setStatusText('Compiling…');
    setStatusKind('info');
    const r = await runLatexCompile();
    if (!r) {
      setStatusText('Ready');
      setStatusKind('info');
      return;
    }
    if (r.ok) {
      setStatusText(`Rendered (${r.runs} run${r.runs === 1 ? '' : 's'})`);
      setStatusKind('ok');
    } else {
      const n = (r.errors ?? []).length;
      setStatusText(`Compile failed (${n} ${n === 1 ? 'issue' : 'issues'})`);
      setStatusKind('error');
    }
  }

  // Auto-compile: re-run when active LaTeX tab content changes (debounced).
  // Skips the very first effect run so we don't compile right after the seed
  // tabs are inserted at boot — only edits / tab switches should trigger.
  const autoCompileSkipFirstRef = useRef(true);
  useEffect(() => {
    if (!autoCompile) return;
    if (lang !== 'latex') return;
    if (!activeTab) return;
    if (autoCompileSkipFirstRef.current) {
      autoCompileSkipFirstRef.current = false;
      return;
    }
    if (autoCompileTimerRef.current) {
      clearTimeout(autoCompileTimerRef.current);
    }
    autoCompileTimerRef.current = window.setTimeout(() => {
      void compileNow();
    }, 300);
    return () => {
      if (autoCompileTimerRef.current) {
        clearTimeout(autoCompileTimerRef.current);
        autoCompileTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCompile, lang, activeTab?.content, activeTab?.id]);

  async function exportLatexPdf() {
    const tab = useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId);
    if (!tab?.latexWorkdirToken) {
      setStatusText('No compiled PDF yet');
      setStatusKind('error');
      return;
    }
    try {
      const target = await dialogSave({
        defaultPath: tab.filePath ? tab.filePath.replace(/\.tex$/i, '.pdf') : undefined,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (typeof target === 'string') {
        await ipc.exportLatexPdf(tab.latexWorkdirToken, target);
        setStatusText('PDF exported');
        setStatusKind('ok');
      }
    } catch (e) {
      console.error('export PDF failed', e);
      setStatusText('Export failed');
      setStatusKind('error');
    }
  }

  async function exportTypstPdf() {
    const tab = useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId);
    if (!tab || tab.lang !== 'typst') return;
    try {
      setStatusText('Compiling PDF…');
      setStatusKind('info');
      const r = await ipc.compileTypstPdf(tab.content, tab.filePath);
      if (!r.ok || !r.pdfBase64) {
        setStatusText(r.error ? `Compile failed: ${r.error.split('\n')[0]}` : 'Compile failed');
        setStatusKind('error');
        return;
      }
      const target = await dialogSave({
        defaultPath: tab.filePath ? tab.filePath.replace(/\.typ$/i, '.pdf') : undefined,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (typeof target === 'string') {
        await ipc.saveBinaryFile(target, r.pdfBase64);
        setStatusText('PDF exported');
        setStatusKind('ok');
      } else {
        setStatusText('Ready');
        setStatusKind('info');
      }
    } catch (e) {
      console.error('export Typst PDF failed', e);
      setStatusText('Export failed');
      setStatusKind('error');
    }
  }

  async function setProjectMain() {
    const tab = useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId);
    if (!tab?.filePath) return;
    try {
      const r = await ipc.collectProjectFiles(tab.filePath);
      type ProjFile = {
        relPath: string;
        absPath: string;
        content: string;
        binaryBase64?: string | null;
        isBib?: boolean;
      };
      useProjectStore.setState({
        rootAbs: tab.filePath,
        rootBasename: tab.filePath.split(/[\\/]/).pop() ?? null,
        activeAbs: tab.filePath,
        files: ((r.files ?? []) as ProjFile[]),
        warnings: r.warnings ?? [],
      });
      setStatusText('Project main set');
      setStatusKind('ok');
    } catch (e) {
      console.error('set main failed', e);
      setStatusText('Set main failed');
      setStatusKind('error');
    }
  }

  async function installPackage(pkg: string) {
    if (!hasTauri()) return;
    setStatusText(`Detecting LaTeX distribution…`);
    setStatusKind('info');
    try {
      const enginePath =
        useSettingsStore.getState().settings.latex_custom_paths[
          useSettingsStore.getState().settings.latex_engine
        ];
      type DistroInfo = { name: string; manager: string; manager_path?: string };
      const distro = (await ipc.detectDistro(enginePath)) as DistroInfo;
      if (!distro?.manager || distro.manager === 'none') {
        setStatusText(`No package manager available for ${distro?.name ?? 'unknown distro'}`);
        setStatusKind('error');
        return;
      }
      // Installing a TeX package runs an external command (tlmgr/miktex/mpm)
      // that fetches and installs software. Require explicit user consent
      // naming the exact package and manager before doing so.
      const consented = await dialogConfirm(
        `Install the TeX package "${pkg}" using ${distro.manager}?\n\n` +
          `This runs an external command that downloads and installs software on your system.`,
        { title: 'Install TeX package' },
      );
      if (!consented) {
        setStatusText(`Install of ${pkg} cancelled`);
        setStatusKind('info');
        return;
      }
      setStatusText(`Installing ${pkg} via ${distro.manager}…`);
      await ipc.installPackage(distro.manager, pkg);
      setStatusText(`Installed ${pkg}`);
      setStatusKind('ok');
      // Re-compile so the missing-file diagnostic clears.
      void compileNow();
    } catch (e) {
      console.error('install package failed', e);
      setStatusText(`Install failed: ${String(e)}`);
      setStatusKind('error');
    }
  }

  // Register baseline commands.
  useEffect(() => {
    const reg = useCommandsStore.getState().register;
    const offs = [
      reg({ id: 'file.open', name: 'Open file…', shortcut: 'Ctrl+O', run: () => openFileDialog() }),
      reg({ id: 'file.save', name: 'Save', shortcut: 'Ctrl+S', run: () => saveActiveTab() }),
      reg({ id: 'file.saveAs', name: 'Save as…', shortcut: 'Ctrl+Shift+S', run: () => saveActiveTab({ saveAs: true }) }),
      reg({ id: 'workspace.openFolder', name: 'Open folder…', shortcut: 'Ctrl+Shift+O', run: openFolder }),
      reg({
        id: 'workspace.closeFolder',
        name: 'Close folder',
        when: () => workspaceFolder !== null,
        run: () => setWorkspaceFolder(null),
      }),
      reg({
        id: 'workspace.refreshFolder',
        name: 'Refresh folder',
        when: () => workspaceFolder !== null,
        run: () => setFolderRefreshKey(k => k + 1),
      }),
      reg({ id: 'app.settings', name: 'Open settings', run: () => setSettingsOpen(true) }),
      reg({
        id: 'app.symbols',
        name: 'Toggle math symbols panel',
        run: () => setSymbolsOpen(o => !o),
      }),
      reg({ id: 'lang.markdown', name: 'Switch to Markdown', run: () => setLang('markdown') }),
      reg({ id: 'lang.latex', name: 'Switch to LaTeX', run: () => setLang('latex') }),
      reg({ id: 'lang.typst', name: 'Switch to Typst', run: () => setLang('typst') }),
      reg({
        id: 'latex.compile',
        name: 'Compile (LaTeX)',
        shortcut: 'Ctrl+B',
        when: () => lang === 'latex',
        run: () => compileNow(),
      }),
      reg({
        id: 'latex.synctexForward',
        name: 'SyncTeX: jump to PDF',
        shortcut: 'Ctrl+Alt+J',
        when: () => lang === 'latex',
        run: async () => {
          const line = editorApiRef.current?.cursorLine() ?? 1;
          await syncTexForwardFromEditor(line);
        },
      }),
      reg({
        id: 'latex.exportPdf',
        name: 'Export PDF',
        shortcut: 'Ctrl+Shift+E',
        when: () => lang === 'latex',
        run: exportLatexPdf,
      }),
      reg({
        id: 'typst.exportPdf',
        name: 'Export PDF (Typst)',
        shortcut: 'Ctrl+Shift+E',
        when: () => lang === 'typst',
        run: exportTypstPdf,
      }),
      reg({
        id: 'latex.setMain',
        name: 'Set current file as project main',
        when: () => lang === 'latex' && !!useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId)?.filePath,
        run: setProjectMain,
      }),
    ];
    return () => offs.forEach(off => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceFolder, activeTab?.id, lang]);

  // Global keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFolder();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFileDialog();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveActiveTab();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveActiveTab({ saveAs: true });
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'b' && lang === 'latex') {
        e.preventDefault();
        void compileNow();
      } else if (mod && e.altKey && e.key.toLowerCase() === 'j' && lang === 'latex') {
        e.preventDefault();
        void syncTexForwardFromEditor(editorApiRef.current?.cursorLine() ?? 1);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (lang === 'latex') void exportLatexPdf();
        else if (lang === 'typst') void exportTypstPdf();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  return (
    <div className={styles.app}>
      <Toolbar
        lang={lang}
        onLangChange={setLang}
        latexEngine={settings.latex_engine}
        onLatexEngineChange={engine => patchAndSave({ latex_engine: engine })}
        autoCompile={autoCompile}
        onAutoCompileChange={setAutoCompile}
        onCompile={compileNow}
        onSynctexForward={() => syncTexForwardFromEditor(editorApiRef.current?.cursorLine() ?? 1)}
        onSetMain={setProjectMain}
        onExportLatexPdf={exportLatexPdf}
        onExportTypstPdf={exportTypstPdf}
        onOpenFile={openFileDialog}
        onOpenFolder={openFolder}
        onSave={() => saveActiveTab()}
        onToggleRecent={() => setRecentOpen(o => !o)}
        onToggleSymbols={() => setSymbolsOpen(o => !o)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        status={hasTauri() ? statusText : 'Browser preview (no Tauri)'}
        statusKind={statusKind}
      />

      <div className={styles.main} ref={mainRef}>
        <Sidebar
          width={sidebarWidth || undefined}
          outline={<OutlineSection onJumpToLine={line => editorApiRef.current?.scrollToLine(line)} />}
          folderTree={
            <FolderTreeSection
              rootPath={workspaceFolder}
              onOpenFolder={openFolder}
              onCloseFolder={() => setWorkspaceFolder(null)}
              onRefresh={() => setFolderRefreshKey(k => k + 1)}
              onFileActivate={path => void openFileByPath(path)}
              refreshKey={folderRefreshKey}
            />
          }
          files={
            useProjectStore.getState().rootAbs ? (
              <FilesSection onFileActivate={path => void openFileByPath(path)} />
            ) : null
          }
          bibliography={lang === 'latex' ? <BibSection onInsertCite={key => editorApiRef.current?.insertCite(key)} /> : null}
        />
        <Splitter onDragStart={startSidebarDrag} onDrag={dragSidebar} onDragEnd={endSidebarDrag} />

        <div className={styles.workArea} ref={workAreaRef}>
          <Tabs />
          <div className={styles.editorRow}>
            <div
              className={styles.editorPane}
              style={editorWidth ? { flex: `0 0 ${editorWidth}px` } : undefined}
            >
              <Suspense fallback={<div className={styles.lazyFallback}>Loading editor…</div>}>
                <ErrorBoundary>
                  <EditorPane
                    onReady={api => {
                      editorApiRef.current = api;
                    }}
                  />
                </ErrorBoundary>
              </Suspense>
            </div>
            <Splitter onDragStart={startEditorDrag} onDrag={dragEditor} onDragEnd={endEditorDrag} />
            <div className={styles.previewPane}>
              <Suspense fallback={<div className={styles.lazyFallback}>Loading preview…</div>}>
                <ErrorBoundary>
                  {lang === 'latex' ? (
                    <PdfViewer
                      onSyncTexBackward={(page, x, y) =>
                        syncTexBackwardFromPdf(page, x, y, line =>
                          editorApiRef.current?.scrollToLine(line),
                        )
                      }
                    />
                  ) : (
                    <PreviewPane />
                  )}
                </ErrorBoundary>
              </Suspense>
            </div>
          </div>
          <div className={styles.logArea}>
            <LogPanel
              onJumpToLine={line => editorApiRef.current?.scrollToLine(line)}
              onInstallPackage={pkg => void installPackage(pkg)}
            />
          </div>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SymbolsPanel
        open={symbolsOpen}
        lang={lang}
        onClose={() => setSymbolsOpen(false)}
        onInsert={text => editorApiRef.current?.insertAtCursor(text)}
      />
      <RecentMenu
        open={recentOpen}
        onClose={() => setRecentOpen(false)}
        onPickPath={path => void openFileByPath(path)}
        onClear={() => void useSettingsStore.getState().patchAndSave({ recent_files: [] })}
      />
    </div>
  );
}
