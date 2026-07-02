import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { hasTauri, dialogOpen, dialogSave, events } from './api/tauri';
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
  const mainRef = useRef<HTMLDivElement>(null);
  const workAreaRef = useRef<HTMLDivElement>(null);

  // Pane widths (live state). Persisted to settings on drag end.
  const [sidebarWidth, setSidebarWidth] = useState<number>(0); // 0 means "use default"
  const [editorWidth, setEditorWidth] = useState<number>(0);

  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(null);
  const [folderRefreshKey, setFolderRefreshKey] = useState(0);

  // Initialise pane widths from persisted settings once they load.
  useEffect(() => {
    if (settings.pane_sidebar_width > 80) setSidebarWidth(settings.pane_sidebar_width);
    if (settings.pane_editor_width > 120) setEditorWidth(settings.pane_editor_width);
  }, [settings.pane_sidebar_width, settings.pane_editor_width]);

  function startSidebarDrag() {
    /* nothing — width state already current */
  }
  function dragSidebar(clientX: number) {
    const main = mainRef.current;
    if (!main) return;
    const left = main.getBoundingClientRect().left;
    const next = Math.max(160, Math.min(640, clientX - left));
    setSidebarWidth(next);
  }
  function endSidebarDrag() {
    void useSettingsStore.getState().patchAndSave({ pane_sidebar_width: sidebarWidth });
  }

  function startEditorDrag() {
    /* nothing */
  }
  function dragEditor(clientX: number) {
    const work = workAreaRef.current;
    if (!work) return;
    const left = work.getBoundingClientRect().left;
    const next = Math.max(200, Math.min(work.clientWidth - 200, clientX - left));
    setEditorWidth(next);
  }
  function endEditorDrag() {
    void useSettingsStore.getState().patchAndSave({ pane_editor_width: editorWidth });
  }
  // Apply UI theme + font + accent color to :root whenever settings change.
  // This drives every CSS variable consumed by tokens.css and component
  // module styles. Keeping it in App.tsx (not buried in a hook file) makes
  // the connection between settings and global look obvious.
  useEffect(() => {
    const root = document.documentElement;

    function resolve(): 'dark' | 'light' {
      if (settings.ui_theme === 'auto') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return settings.ui_theme;
    }

    function apply() {
      const resolved = resolve();
      root.setAttribute('data-theme', resolved);

      // Editor theme follows app theme: pick a sensible default for whichever
      // mode we're in. Users who explicitly chose another editor theme keep it
      // — we only swap when the saved theme matches the "default of the other
      // mode", so manual choices stick.
      const currentEditorTheme = useSettingsStore.getState().settings.editor_theme;
      if (resolved === 'light' && currentEditorTheme === 'vscode-dark') {
        useSettingsStore.getState().patch({ editor_theme: 'vscode-light' });
      } else if (resolved === 'dark' && currentEditorTheme === 'vscode-light') {
        useSettingsStore.getState().patch({ editor_theme: 'vscode-dark' });
      }
    }

    apply();

    // If user picked "auto", listen to OS color-scheme changes.
    if (settings.ui_theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => apply();
      mq.addEventListener('change', onChange);
      // Cleanup follows in the *next* dependency run via this returned fn.
      // Other style mutations below still need to happen even when not auto.
      // We split out font/accent mutations into a separate effect for clarity.
      return () => mq.removeEventListener('change', onChange);
    }
  }, [settings.ui_theme]);

  // Apply font + accent + arbitrary color overrides separately so toggling
  // theme doesn't waste a re-run on these.
  useEffect(() => {
    const root = document.documentElement;

    if (settings.ui_font_family) {
      root.style.setProperty('--font-sans', settings.ui_font_family);
    }
    document.body.style.fontSize = `${settings.ui_font_size}px`;

    if (settings.ui_accent_color) {
      root.style.setProperty('--accent', settings.ui_accent_color);
    } else {
      root.style.removeProperty('--accent');
    }

    const ov = settings.ui_color_overrides ?? {};
    const knownKeys: string[] = (root.dataset.clavisOverrideKeys ?? '').split(',').filter(Boolean);
    for (const key of knownKeys) {
      if (!(key in ov)) root.style.removeProperty(`--${key}`);
    }
    for (const [key, value] of Object.entries(ov)) {
      if (value) root.style.setProperty(`--${key}`, value);
    }
    root.dataset.clavisOverrideKeys = Object.keys(ov).join(',');
  }, [
    settings.ui_font_family,
    settings.ui_font_size,
    settings.ui_accent_color,
    settings.ui_color_overrides,
  ]);

  // Boot: load persisted settings, seed three sample tabs (one per language)
  // so the UI is not empty on first launch.
  useEffect(() => {
    if (hasTauri()) loadSettings();
    if (useTabsStore.getState().tabs.length === 0) {
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
  }, [loadSettings, addTab]);

  // Subscribe to OS file-drop so dropping a file/folder on the window opens it.
  useEffect(() => {
    if (!hasTauri()) return;
    let off: (() => void) | undefined;
    events.onFileDrop(paths => {
      if (!paths?.length) return;
      const first = paths[0];
      // Heuristic: directories don't have an extension. Better would be to
      // call fs.exists or stat, but the legacy code took the same shortcut.
      const looksLikeDir = !/\.[^\\/]+$/.test(first);
      if (looksLikeDir) setWorkspaceFolder(first);
      else void openFileByPath(first);
    }).then(unlisten => {
      off = unlisten;
    });
    return () => off?.();
  }, []);

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
    if (!autoCompile) {
      console.info('[auto] disabled');
      return;
    }
    if (lang !== 'latex') return;
    if (!activeTab) return;
    if (autoCompileSkipFirstRef.current) {
      autoCompileSkipFirstRef.current = false;
      console.info('[auto] skipping first run after mount');
      return;
    }
    if (autoCompileTimerRef.current) {
      clearTimeout(autoCompileTimerRef.current);
    }
    setStatusText('Auto-compile scheduled…');
    setStatusKind('info');
    console.info('[auto] scheduled (300ms)');
    autoCompileTimerRef.current = window.setTimeout(() => {
      console.info('[auto] firing compileNow');
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
