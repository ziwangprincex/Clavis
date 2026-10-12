import { resolveLocale, t } from './i18n';
import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { hasTauri, dialogOpen, dialogSave, dialogConfirm } from './api/tauri';
import { useSettingsStore, useTabsStore, useProjectStore, usePdfStore, useStatusStore, useReferencesStore, useAssetsStore, useWritingStore, useCompileStore, type EditorLayout, type Lang, newTabId } from './store';
import { useCommandsStore } from './store/commands';
import { fmtShortcut, isMac } from './platform';
import { Toolbar } from './components/Toolbar';
import { StartActions } from './components/StartActions';
import { WriterDialog, type WriterTool } from './components/WriterDialog';
import { TitleBar } from './components/TitleBar';
import { StatusBar } from './components/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { QuickOpen } from './components/QuickOpen';
import { SettingsDialog } from './components/SettingsDialog';
import { LogPanel } from './components/LogPanel';
import { WorkspaceSearchDialog } from './components/WorkspaceSearchDialog';
import { Tabs } from './components/Tabs';
import { Sidebar, type SidebarView } from './components/Sidebar';
import { OutlineSection } from './components/OutlineSection';
import { TodoSection } from './components/TodoSection';
import { FolderTreeSection } from './components/FolderTreeSection';
import { FilesSection } from './components/FilesSection';
import { BibSection } from './components/BibSection';
import { ReferencesSection } from './components/ReferencesSection';
import { AssetsSection } from './components/AssetsSection';
import { WritingSection } from './components/WritingSection';
import { RenameReferenceDialog } from './components/RenameReferenceDialog';
import { TableConvertDialog } from './components/TableConvertDialog';
import type { EditorPaneRef } from './components/EditorPane';
import { runLatexCompile, stopLatexCompile } from './compile/latex';
import { documentRoot, inside, latexOptions, typstInput } from './compile/project';
import { useTypstPreviewStore } from './store/typstPreview';
import { belongsToPdf } from './compile/target';
import { syncTexBackwardFromPdf, syncTexForwardFromEditor } from './compile/synctex';
import { openFileDialog, openFileByPath, saveActiveTab, openFileAndScrollToLine, pushRecentFolder } from './files/files';
import { pathsEqual, resolveIncludeTarget, resolveSyncTexFile, resolveTypstTarget } from './files/projectPaths';
import { checkForUpdates } from './update/updater';
import { restoreSession } from './files/session';
import { useAppTheme } from './hooks/useAppTheme';
import { useSessionPersistence } from './hooks/useSessionPersistence';
import { useLatexAutoCompile } from "./hooks/useLatexAutoCompile";
import { useDocumentSync } from './hooks/useDocumentSync';
import { SaveConflictNotice } from './components/SaveConflictNotice';
import { checkExternalDocuments } from './files/documentSync';
import { useFileDrop } from './hooks/useFileDrop';
import { usePaneLayout } from './hooks/usePaneLayout';
import { ipc } from './api/tauri';
import { SymbolsPanel } from './components/SymbolsPanel';
import { RecentMenu } from './components/RecentMenu';
import { Splitter } from './components/Splitter';
import { ErrorBoundary } from './components/ErrorBoundary';
import { writingPolicyFromConfig } from './writing/options';
import { latexEnvironmentDeclarationLine, latexMacroDeclarationLine, latexWorkspaceEnvironments, latexWorkspaceMacros } from './completions/latexMacroScan';
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

/** Write / Split / Read, in the order of their Cmd+2/3/4 shortcuts. */
const LAYOUTS = ['editor', 'split', 'preview'] as const;

export function App() {
  const loadSettings = useSettingsStore(s => s.load);
  const settings = useSettingsStore(s => s.settings);
  const patchAndSave = useSettingsStore(s => s.patchAndSave);

  // Typing changes tab content on every keystroke. The shell subscribes only
  // to what it draws, so it does not re-render while the user writes.
  const addTab = useTabsStore(s => s.addTab);
  const tabCount = useTabsStore(s => s.tabs.length);
  const activeTab = useTabsStore(useShallow(s => {
    const tab = s.tabs.find(t => t.id === s.activeTabId);
    return tab && { id: tab.id, lang: tab.lang, filePath: tab.filePath, isDirty: tab.isDirty, empty: tab.content === '' };
  }));
  const hasText = useTabsStore(s => s.tabs.some(tab => /\S/.test(tab.content)));
  const dirtyPaths = useTabsStore(useShallow(s => s.tabs.filter(tab => tab.isDirty && tab.filePath).map(tab => tab.filePath!)));
  const latexEngine = useTabsStore(s => {
    const tab = s.tabs.find(t => t.id === s.activeTabId);
    if (tab?.lang !== 'latex') return settings.latex_engine;
    try { return latexOptions(tab, s.tabs.find(t => pathsEqual(t.filePath, documentRoot(tab)))?.content ?? tab.content).engine; } catch { return settings.latex_engine; }
  });
  const lang: Lang = activeTab?.lang ?? 'markdown';
  const workspaceInspection = useProjectStore(s => s.workspace);
  const projectRoot = useProjectStore(s => s.rootAbs);
  const projectFiles = useProjectStore(s => s.files);
  const problemCount = useCompileStore(s => s.errors.length);

  const [startTabId, setStartTabId] = useState<string | null>(null);
  const [bootReady, setBootReady] = useState(() => useTabsStore.getState().tabs.length > 0);
  const [focusMode, setFocusMode] = useState(false);
  // Markdown is formatted in place, so it never needs a second pane.
  const layout = focusMode || lang === 'markdown' ? 'editor' : settings.editor_layout;
  const [sidebarView, setSidebarView] = useState<SidebarView>('documents');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [writerTool, setWriterTool] = useState<WriterTool | null>(null);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const [renameReferenceOpen, setRenameReferenceOpen] = useState(false);
  const [tableConvertOpen, setTableConvertOpen] = useState(false);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [autoCompile, setAutoCompile] = useState(true);
  const setStatus = useStatusStore(s => s.set);
  // Typora's Shift+Cmd+L; leaving Focus brings the sidebar back.
  const toggleSidebar = () => {
    setFocusMode(false);
    void patchAndSave({ sidebar_visible: focusMode || !useSettingsStore.getState().settings.sidebar_visible });
  };
  const setLayout = (next: EditorLayout) => { setFocusMode(false); void patchAndSave({ editor_layout: next }); };
  /** Outline and to-do rows: the source line, or in Read the matching place in the preview. */
  const jumpToSource = (absPath: string | null, line: number) => {
    if (layout !== 'preview') void openFileAndScrollToLine(absPath, line, l => editorApiRef.current?.scrollToLine(l));
    else if (lang === 'typst') useTypstPreviewStore.getState().requestJump(absPath ?? activeTab?.filePath ?? null, line);
    else void openFileAndScrollToLine(absPath, line, l => { void syncTexForwardFromEditor(l); });
  };
  const showProblems = () => {
    setFocusMode(false);
    setSidebarView('problems');
    if (!useSettingsStore.getState().settings.sidebar_visible) void patchAndSave({ sidebar_visible: true });
  };

  const toggleProblems = useCallback(() => {
    const sidebarVisible = useSettingsStore.getState().settings.sidebar_visible;
    const visible = sidebarVisible && !focusMode;
    setFocusMode(false);
    setSidebarView(view => visible && view === 'problems' ? 'documents' : 'problems');
    if (!sidebarVisible) void patchAndSave({ sidebar_visible: true });
  }, [focusMode, patchAndSave]);

  useEffect(() => {
    if (lang !== 'latex') setSidebarView(view => view === 'problems' ? 'documents' : view);
  }, [lang]);

  const editorApiRef = useRef<EditorPaneRef | null>(null);
  const workspaceOpenSeqRef = useRef(0);

  const workspaceFolder = useProjectStore(s => s.folderPath);
  const [folderRefreshKey, setFolderRefreshKey] = useState(0);

  // Pane widths + drag handlers (owns mainRef / editorRowRef).
  const {
    mainRef,
    editorRowRef,
    sidebarWidth,
    editorRatio,
    startSidebarDrag,
    dragSidebar,
    endSidebarDrag,
    startEditorDrag,
    dragEditor,
    endEditorDrag,
  } = usePaneLayout(settings, layout);

  // Apply UI theme / fonts / accent / color overrides to :root.
  useAppTheme(settings);

  // Boot: load persisted settings, then restore the previous session (crash
  // recovery). If there's nothing to restore, open a single empty scratch tab
  // (not the old three Welcome samples) so the editor is ready to type in.
  useEffect(() => {
    if (hasTauri()) loadSettings();
    if (useTabsStore.getState().tabs.length > 0) { setBootReady(true); return; }

    function seedScratchTab() {
      const id = newTabId();
      useTabsStore.getState().addTab({
        id,
        title: 'Untitled.md',
        filePath: null,
        lang: 'markdown',
        content: '',
        isDirty: false,
      });
    }

    void (async () => {
      const restored = hasTauri() ? await restoreSession() : false;
      const folder = useProjectStore.getState().folderPath;
      if (folder) void openWorkspaceFolder(folder, true);
      if (!restored && useTabsStore.getState().tabs.length === 0) {
        seedScratchTab();
        if (!folder) setStartTabId(useTabsStore.getState().activeTabId);
      }
      setBootReady(true);
    })();
  }, [loadSettings, addTab]);

  // Start actions belong only to the untouched first-run buffer, never restored work.
  useEffect(() => {
    if (startTabId && (tabCount !== 1 || activeTab?.id !== startTabId || !activeTab.empty || activeTab.isDirty || activeTab.filePath)) setStartTabId(null);
  }, [startTabId, tabCount, activeTab]);

  function newBlankNote() {
    const state = useTabsStore.getState();
    const tab = state.tabs.find(item => item.id === state.activeTabId);
    if (tab?.id !== startTabId || tab?.content || tab?.isDirty || tab?.filePath) {
      state.addTab({ id: newTabId(), title: 'Untitled.md', filePath: null, lang: 'markdown', content: '', isDirty: false });
    }
    setStartTabId(null);
    setFocusMode(false);
  }

  async function openCreatedProject(main: string) {
    await openWorkspaceFolder(main.replace(/[\\/][^\\/]*$/, ''));
    setFocusMode(false);
    // New typesetting projects should show their output beside the source.
    if (/\.(tex|typ)$/i.test(main)) await patchAndSave({ editor_layout: 'split' });
  }

  // Quietly check for a newer release once at startup (no-op in browser preview,
  // silent when already up to date). Manual "Check for Updates…" lives in the
  // command palette below.
  useEffect(() => {
    if (!hasTauri()) {
      setStatus('Browser preview (no Tauri)', 'info');
      return;
    }
    void checkForUpdates({ silent: true });
  }, []);

  // Persist session (debounced) on tab changes + flush on unload; manage the
  // disk-autosave interval.
  useSessionPersistence(settings.autosave_enabled, bootReady);
  useDocumentSync();

  function refreshReferences(root = workspaceFolder) {
    if (!root || !hasTauri()) return;
    void useReferencesStore.getState().refresh(root, useTabsStore.getState().tabs);
  }

  function refreshAssets(root = workspaceFolder) {
    if (!root || !hasTauri()) return;
    void useAssetsStore.getState().refresh(root, useTabsStore.getState().tabs);
  }

  function refreshWriting() {
    const policy = writingPolicyFromConfig(useProjectStore.getState().workspace?.config);
    useWritingStore.getState().refresh(useTabsStore.getState().tabs, policy);
  }

  // Set the workspace folder and inspect optional clavis.toml metadata.
  async function openWorkspaceFolder(path: string, restoring = false) {
    const openSeq = ++workspaceOpenSeqRef.current;
    useProjectStore.getState().setProject({ folderPath: path });
    useProjectStore.getState().setProject({ workspace: null });
    if (!restoring) void pushRecentFolder(path);
    if (!hasTauri()) return;

    try {
      const workspace = await ipc.inspectWorkspace(path);
      if (openSeq !== workspaceOpenSeqRef.current) return;
      useProjectStore.getState().setProject({ workspace });
      refreshReferences(workspace.root);
      refreshAssets(workspace.root);
      refreshWriting();
      if (workspace.issues.length > 0) setStatus(`Project config: ${workspace.issues[0]}`, 'error');
    } catch (error) {
      console.warn('workspace inspection failed', error);
      setStatus('Workspace opened; project config could not be inspected', 'error');
    }
  }

  function closeWorkspaceFolder() {
    workspaceOpenSeqRef.current += 1;
    useProjectStore.getState().setProject({ folderPath: null });
    useProjectStore.getState().setProject({ workspace: null });
    useReferencesStore.getState().clear();
    useAssetsStore.getState().clear();
    useWritingStore.getState().clear();
  }

  // OS file-drop: files open, folders become the workspace.
  useFileDrop(path => { void openWorkspaceFolder(path); }, text => editorApiRef.current?.insertAtCursor(text));

  async function openFolder() {
    if (!hasTauri()) return;
    try {
      const result = await dialogOpen({ directory: true, multiple: false });
      if (typeof result === 'string') {
        await openWorkspaceFolder(result);
      }
    } catch (e) {
      console.error('open folder failed', e);
    }
  }

  function setLang(next: Lang) {
    if (!activeTab) return;
    useTabsStore.getState().patchTab(activeTab.id, { lang: next });
  }

  function jumpToPreview() {
    const line = editorApiRef.current?.cursorLine() ?? 1;
    if (lang === 'typst') useTypstPreviewStore.getState().requestJump(activeTab?.filePath ?? null, line);
    else void syncTexForwardFromEditor(line);
  }

  async function compileNow() {
    if (!hasTauri()) return;
    await runLatexCompile();
  }

  // Re-run writing checks once edits settle, without re-rendering the shell.
  useEffect(() => {
    let timer = setTimeout(refreshWriting, 700);
    const off = useTabsStore.subscribe((state, previous) => {
      if (state.tabs === previous.tabs) return;
      clearTimeout(timer);
      timer = setTimeout(refreshWriting, 700);
    });
    return () => { off(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportLatexPdf() {
    const tab = useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId);
    const pdf = usePdfStore.getState();
    if (!tab || !pdf.bytes || !pdf.workdirToken || !belongsToPdf(tab, pdf)) {
      setStatus('No compiled PDF yet', 'error');
      return;
    }
    try {
      const target = await dialogSave({
        defaultPath: pdf.sourceRoot ? pdf.sourceRoot.replace(/\.tex$/i, '.pdf') : undefined,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (typeof target === 'string') {
        const latest = usePdfStore.getState();
        if (latest.workdirToken !== pdf.workdirToken || latest.bytes !== pdf.bytes) {
          setStatus('The preview changed during export. Export again after compilation finishes.', 'error');
          return;
        }
        await ipc.exportLatexPdf(pdf.workdirToken!, target);
        setStatus('PDF exported', 'ok');
      }
    } catch (e) {
      console.error('export PDF failed', e);
      setStatus('Export failed', 'error');
    }
  }

  /** Markdown has no typeset output; it exports as one self-contained HTML file. */
  function exportHtml() {
    const tab = useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId);
    if (tab?.lang !== 'markdown') return;
    const language = resolveLocale(useSettingsStore.getState().settings.ui_language);
    void import('./files/exportMarkdown').then(module => module.exportMarkdownHtml(tab, language));
  }

  async function exportTypstPdf() {
    const tab = useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId);
    if (!tab || tab.lang !== 'typst') return;
    try {
      setStatus('Compiling PDF…', 'info');
      const input = await typstInput(tab);
      const r = await ipc.compileTypstPdf(input.source, input.docPath, input.snapshot);
      if (!r.ok || !r.pdfBase64) {
        setStatus(r.error ? `Compile failed: ${r.error.split('\n')[0]}` : t("Compile failed"), 'error');
        return;
      }
      const target = await dialogSave({
        defaultPath: input.docPath ? input.docPath.replace(/\.typ$/i, '.pdf') : undefined,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (typeof target === 'string') {
        await ipc.saveBinaryFile(target, r.pdfBase64);
        setStatus('PDF exported', 'ok');
      } else {
        setStatus('Ready', 'info');
      }
    } catch (e) {
      console.error('export Typst PDF failed', e);
      setStatus('Export failed', 'error');
    }
  }

  async function setProjectMain() {
    const tab = useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId);
    if (!tab?.filePath) return;
    try {
      const r = tab.lang === 'latex' ? await ipc.collectProjectFiles(tab.filePath) : { files: [], warnings: [] };
      const directory = tab.filePath.replace(/[\\/][^\\/]*$/, '');
      for (const other of useTabsStore.getState().tabs) {
        if (other.lang === tab.lang && inside(other.filePath, directory)) useTabsStore.getState().patchTab(other.id, { projectRoot: tab.filePath });
      }
      useProjectStore.setState({
        rootAbs: tab.filePath,
        rootBasename: tab.filePath.split(/[\\/]/).pop() ?? null,
        activeAbs: tab.filePath,
        files: r.files ?? [],
        warnings: r.warnings ?? [],
      });
      setStatus('Project main set', 'ok');
    } catch (e) {
      console.error('set main failed', e);
      setStatus('Set main failed', 'error');
    }
  }

  async function installPackage(pkg: string) {
    if (!hasTauri()) return;
    setStatus(`Detecting LaTeX distribution…`, 'info');
    try {
      const enginePath =
        useSettingsStore.getState().settings.latex_custom_paths[
          useSettingsStore.getState().settings.latex_engine
        ];
      const distro = await ipc.detectDistro(enginePath);
      if (!distro?.manager || distro.manager === 'none') {
        setStatus(`No package manager available for ${distro?.name ?? 'unknown distro'}`, 'error');
        return;
      }
      // Installing a TeX package runs an external command (tlmgr/miktex/mpm)
      // that fetches and installs software. Require explicit user consent
      // naming the exact package and manager before doing so.
      const consented = await dialogConfirm(
        `Install the TeX package "${pkg}" using ${distro.manager}?\n\n` +
          `An external command will download and install software on this system.`,
        { title: 'Install TeX package' },
      );
      if (!consented) {
        setStatus(`Install of ${pkg} cancelled`, 'info');
        return;
      }
      setStatus(`Installing ${pkg} via ${distro.manager}…`, 'info');
      await ipc.installPackage(distro.manager, pkg);
      setStatus(`Installed ${pkg}`, 'ok');
      // Re-compile so the missing-file diagnostic clears.
      void compileNow();
    } catch (e) {
      console.error('install package failed', e);
      setStatus(`Install failed: ${String(e)}`, 'error');
    }
  }

  // Register baseline commands.
  useEffect(() => {
    const reg = useCommandsStore.getState().register;
    const offs = [
      reg({ id: 'view.focus', name: 'Toggle focus mode', shortcut: fmtShortcut('Ctrl+Shift+Enter'), run: () => setFocusMode(value => !value) }),
      reg({ id: 'view.sidebar', name: 'Toggle sidebar', shortcut: fmtShortcut('Ctrl+Shift+L'), run: toggleSidebar }),
      reg({ id: 'view.typewriter', name: 'Toggle typewriter scrolling', run: () => void patchAndSave({ editor_typewriter: !useSettingsStore.getState().settings.editor_typewriter }) }),
      ...LAYOUTS.map((layout, i) => reg({ id: `view.${layout}`, name: layout === 'editor' ? t("Editor only") : layout === 'preview' ? t("Preview only") : t("Split view"), shortcut: fmtShortcut(`Ctrl+${i + 2}`), when: () => lang !== 'markdown', run: () => setLayout(layout) })),
      reg({
        id: 'markdown.source',
        name: 'Toggle Markdown source',
        shortcut: fmtShortcut('Ctrl+/'),
        when: () => lang === 'markdown',
        run: () => void patchAndSave({ markdown_source_mode: !useSettingsStore.getState().settings.markdown_source_mode }),
      }),
      reg({
        id: 'markdown.formatTable',
        name: 'Format table source',
        when: () => lang === 'markdown',
        run: () => { if (!editorApiRef.current?.formatTable()) setStatus('Place the cursor in a table to format it.', 'info'); },
      }),
      reg({ id: 'file.quickOpen', name: 'Quick Open…', shortcut: fmtShortcut('Ctrl+P'), run: () => setQuickOpen(true) }),
      reg({ id: 'file.new', name: 'New document', shortcut: fmtShortcut('Ctrl+N'), run: newBlankNote }),
      reg({ id: 'writer.templates', name: 'New from template…', run: () => setWriterTool('templates') }),
      reg({ id: 'writer.history', name: 'Local version timeline…', when: () => !!useTabsStore.getState().activeTabId, run: () => setWriterTool('history') }),
      reg({ id: 'writer.environment', name: 'Check environment…', run: () => setWriterTool('environment') }),
      reg({ id: 'file.open', name: 'Open file…', shortcut: fmtShortcut('Ctrl+O'), run: () => openFileDialog() }),
      reg({ id: 'file.save', name: 'Save', shortcut: fmtShortcut('Ctrl+S'), run: () => saveActiveTab() }),
      reg({ id: 'file.saveAs', name: 'Save as…', shortcut: fmtShortcut('Ctrl+Shift+S'), run: () => saveActiveTab({ saveAs: true }) }),
      reg({ id: 'workspace.openFolder', name: 'Open folder…', shortcut: fmtShortcut('Ctrl+Shift+O'), run: openFolder }),
      reg({
        id: 'workspace.closeFolder',
        name: 'Close folder',
        when: () => workspaceFolder !== null,
        run: closeWorkspaceFolder,
      }),
      reg({
        id: 'workspace.refreshFolder',
        name: 'Refresh folder',
        when: () => workspaceFolder !== null,
        run: () => setFolderRefreshKey(k => k + 1),
      }),
      reg({
        id: 'workspace.writing.refresh',
        name: 'Refresh Writing Checks',
        when: () => useTabsStore.getState().tabs.length > 0,
        run: () => refreshWriting(),
      }),
      reg({
        id: 'workspace.references.rename',
        name: 'Rename Label or Citation Key',
        when: () => workspaceFolder !== null,
        run: () => setRenameReferenceOpen(true),
      }),
      reg({
        id: 'workspace.assets.refresh',
        name: 'Refresh Asset Index',
        when: () => workspaceFolder !== null,
        run: () => refreshAssets(),
      }),
      reg({
        id: 'workspace.references.refresh',
        name: 'Refresh References Index',
        when: () => workspaceFolder !== null,
        run: () => refreshReferences(),
      }),
      reg({
        id: 'workspace.search',
        name: 'Search / Replace in Workspace',
        shortcut: fmtShortcut('Ctrl+Shift+F'),
        when: () => workspaceFolder !== null,
        run: () => setWorkspaceSearchOpen(true),
      }),
      reg({ id: 'app.settings', name: 'Open settings', shortcut: isMac ? '⌘,' : undefined, run: () => setSettingsOpen(true) }),
      reg({ id: 'app.checkUpdates', name: 'Check for Updates…', run: () => checkForUpdates({ silent: false }) }),
      reg({
        id: 'table.convert',
        name: 'Convert CSV / TSV to Table',
        when: () => !!useTabsStore.getState().activeTabId,
        run: () => setTableConvertOpen(true),
      }),
      reg({
        id: 'app.symbols',
        name: 'Toggle math symbols panel',
        run: () => setSymbolsOpen(o => !o),
      }),
      // Keep the raw log reachable even when the parser found no diagnostics.
      // Like the status chip, this command toggles the visible Problems view.
      reg({
        id: 'view.toggleProblems',
        name: 'Toggle problems panel (LaTeX)',
        when: () => lang === 'latex',
        run: toggleProblems,
      }),
      reg({ id: 'lang.markdown', name: 'Switch to Markdown', run: () => setLang('markdown') }),
      reg({ id: 'lang.latex', name: 'Switch to LaTeX', run: () => setLang('latex') }),
      reg({ id: 'lang.typst', name: 'Switch to Typst', run: () => setLang('typst') }),
      reg({
        id: 'latex.compile',
        name: 'Compile (LaTeX)',
        shortcut: fmtShortcut('Ctrl+B'),
        when: () => lang === 'latex',
        run: () => compileNow(),
      }),
      reg({
        id: 'latex.synctexForward',
        name: 'SyncTeX: jump to PDF',
        shortcut: fmtShortcut('Ctrl+Alt+J'),
        when: () => lang === 'latex',
        run: async () => {
          const line = editorApiRef.current?.cursorLine() ?? 1;
          await syncTexForwardFromEditor(line);
        },
      }),
      reg({
        id: 'latex.exportPdf',
        name: 'Export PDF',
        shortcut: fmtShortcut('Ctrl+Shift+E'),
        when: () => lang === 'latex',
        run: exportLatexPdf,
      }),
      reg({
        id: 'typst.exportPdf',
        name: 'Export PDF (Typst)',
        shortcut: fmtShortcut('Ctrl+Shift+E'),
        when: () => lang === 'typst',
        run: exportTypstPdf,
      }),
      reg({
        id: 'markdown.exportHtml',
        name: 'Export HTML…',
        shortcut: fmtShortcut('Ctrl+Shift+E'),
        when: () => lang === 'markdown',
        run: exportHtml,
      }),
      reg({ id: 'typeset.jump', name: 'Typst: jump to preview', when: () => lang === 'typst', run: jumpToPreview }),
      reg({ id: 'latex.quick', name: 'LaTeX: quick preview (one pass)', when: () => lang === 'latex', run: () => runLatexCompile('quick').then(() => {}) }),
      reg({ id: 'latex.clean', name: 'LaTeX: clean rebuild', when: () => lang === 'latex', run: () => runLatexCompile('clean').then(() => {}) }),
      reg({ id: 'latex.full', name: 'LaTeX: full build with latexmk', when: () => lang === 'latex', run: () => runLatexCompile('full').then(() => {}) }),
      reg({ id: 'latex.stop', name: 'LaTeX: stop compilation', when: () => lang === 'latex', run: stopLatexCompile }),
      reg({
        id: 'latex.setMain',
        name: 'Set current file as project main',
        when: () => lang !== 'markdown' && !!useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId)?.filePath,
        run: setProjectMain,
      }),
    ];
    return () => offs.forEach(off => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceFolder, activeTab?.id, lang, startTabId, settings.editor_layout, toggleProblems]);

  // Focus is temporary: leaving it restores the user's exact pane preferences.
  useEffect(() => {
    function onFocusKey(event: KeyboardEvent) {
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return;
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'Enter') {
        event.preventDefault();
        setFocusMode(value => !value);
      } else if (event.key === 'Escape' && !event.defaultPrevented && !paletteOpen && !settingsOpen) {
        setFocusMode(false);
      }
    }
    window.addEventListener('keydown', onFocusKey);
    return () => window.removeEventListener('keydown', onFocusKey);
  }, [paletteOpen, settingsOpen]);

  // Global keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || (e.target instanceof Element && e.target.closest('[role="dialog"]'))) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setQuickOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (workspaceFolder) setWorkspaceSearchOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFolder();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newBlankNote();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFileDialog();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveActiveTab();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveActiveTab({ saveAs: true });
      } else if (mod && e.shiftKey && e.code === 'KeyL') {
        e.preventDefault();
        toggleSidebar();
      } else if (mod && !e.shiftKey && !e.altKey && /^Digit[234]$/.test(e.code) && lang !== 'markdown') {
        // Texifier's Cmd+2/3/4; in Markdown these keys set heading levels.
        e.preventDefault();
        setLayout(LAYOUTS[Number(e.code.slice(5)) - 2]);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'b' && lang === 'latex') {
        e.preventDefault();
        void compileNow();
      } else if (mod && e.altKey && e.code === 'KeyJ' && lang === 'latex') {
        e.preventDefault();
        void syncTexForwardFromEditor(editorApiRef.current?.cursorLine() ?? 1);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (lang === 'latex') void exportLatexPdf();
        else if (lang === 'typst') void exportTypstPdf();
        else exportHtml();
      } else if (isMac && e.metaKey && !e.shiftKey && !e.altKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'a'
        && !(e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input, textarea')))) {
        // Outside text, Select All would highlight every label in the window.
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, workspaceFolder, startTabId]);

  return (
    <div className={`${styles.app} ${focusMode ? styles.focusMode : ''}`} data-layout={layout}>
      <TitleBar>
      <Toolbar
        focusMode={focusMode}
        onToggleFocus={() => setFocusMode(value => !value)}
        layout={layout}
        onLayoutChange={setLayout}
        sidebarVisible={!focusMode && settings.sidebar_visible}
        onToggleSidebar={toggleSidebar}
        lang={lang}
        onLangChange={setLang}
        latexEngine={latexEngine}
        onLatexEngineChange={engine => {
          const { tabs, activeTabId } = useTabsStore.getState();
          const tab = tabs.find(t => t.id === activeTabId);
          if (!tab) return;
          const owner = tabs.find(t => pathsEqual(t.filePath, documentRoot(tab))) ?? tab;
          useTabsStore.getState().patchTab(owner.id, { latexEngineOverride: engine });
        }}
        autoCompile={autoCompile}
        onAutoCompileChange={setAutoCompile}
        onCompile={compileNow}
        onStopCompile={() => void stopLatexCompile()}
        onQuickCompile={() => void runLatexCompile('quick')}
        onCleanCompile={() => void runLatexCompile('clean')}
        onFullCompile={() => void runLatexCompile('full')}
        onSynctexForward={jumpToPreview}
        onSetMain={setProjectMain}
        onExportLatexPdf={exportLatexPdf}
        onExportTypstPdf={exportTypstPdf}
        onExportHtml={exportHtml}
        onOpenFile={openFileDialog}
        onOpenFolder={openFolder}
        onSave={() => saveActiveTab()}
        onToggleRecent={() => setRecentOpen(o => !o)}
        onToggleSymbols={() => setSymbolsOpen(o => !o)}
        onWriterTool={setWriterTool}
        onNewDocument={newBlankNote}
        inlineMath={settings.editor_inline_math}
        onInlineMathChange={value => void patchAndSave({ editor_inline_math: value })}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCommandPalette={() => setPaletteOpen(true)}
      />
      </TitleBar>

      <div className={styles.main} ref={mainRef}>
        <Sidebar
          hidden={focusMode || !settings.sidebar_visible}
          width={sidebarWidth || undefined}
          onOpenFolder={openFolder}
          view={sidebarView}
          onViewChange={setSidebarView}
          problemCount={problemCount}
          problems={lang === 'latex' ? (
            <LogPanel
              onEnvironment={() => setWriterTool('environment')}
              onSettings={() => setSettingsOpen(true)}
              onFullBuild={() => void runLatexCompile('full')}
              onJumpTo={(file, line) => {
                const project = useProjectStore.getState();
                const absPath = resolveSyncTexFile(file, project.files, project.rootAbs);
                void openFileAndScrollToLine(absPath, line, l =>
                  editorApiRef.current?.scrollToLine(l),
                );
              }}
              onInstallPackage={pkg => void installPackage(pkg)}
            />
          ) : null}
          outline={<>
            <OutlineSection onJumpTo={jumpToSource} />
            <TodoSection onJumpTo={line => jumpToSource(null, line)} />
          </>}
          folderTree={
            <FolderTreeSection
              rootPath={workspaceFolder}
              onOpenFolder={openFolder}
              onCloseFolder={closeWorkspaceFolder}
              onFileActivate={path => void openFileByPath(path)}
              refreshKey={folderRefreshKey}
            />
          }
          files={
            !(workspaceFolder && projectRoot && inside(projectRoot, workspaceFolder)) && lang === 'latex' && projectRoot && projectFiles.length > 0 && activeTab && (pathsEqual(activeTab.filePath, projectRoot) || projectFiles.some(file => pathsEqual(file.absPath, activeTab.filePath))) ? (
              <FilesSection onFileActivate={path => void openFileByPath(path)} />
            ) : null
          }
          writing={hasText ? (
            <WritingSection
              policy={writingPolicyFromConfig(workspaceInspection?.config)}
              onRefresh={() => refreshWriting()}
              onActivate={(path, line) =>
                void openFileAndScrollToLine(path, line, target => editorApiRef.current?.scrollToLine(target))
              }
            />
          ) : null}
          assets={workspaceFolder ? (
            <AssetsSection
              root={workspaceFolder}
              language={lang}
              onInsert={text => editorApiRef.current?.insertAtCursor(text)}
              onRefresh={() => refreshAssets()}
              onActivate={(path, line) =>
                void openFileAndScrollToLine(path, line, target => editorApiRef.current?.scrollToLine(target))
              }
            />
          ) : null}
          references={workspaceFolder && lang !== 'markdown' ? (
            <ReferencesSection
              onRefresh={() => refreshReferences()}
              onActivate={(path, line) =>
                void openFileAndScrollToLine(path, line, target => editorApiRef.current?.scrollToLine(target))
              }
            />
          ) : null}
          bibliography={workspaceFolder && lang !== 'markdown' ? (
            <BibSection
              onInsertCites={keys => editorApiRef.current?.insertCites(keys)}
              onJumpToSource={(absPath, line) =>
                void openFileAndScrollToLine(absPath, line, l =>
                  editorApiRef.current?.scrollToLine(l),
                )
              }
            />
          ) : null}
        />
        {!focusMode && settings.sidebar_visible && (
          <Splitter onDragStart={startSidebarDrag} onDrag={dragSidebar} onDragEnd={endSidebarDrag} />
        )}

        <div className={styles.workArea}>
          {bootReady && !focusMode && ((startTabId && activeTab?.id === startTabId && activeTab.empty && !activeTab.filePath && !activeTab.isDirty && tabCount === 1) || !tabCount) && <StartActions onOpen={openFileDialog} onFolder={openFolder} onNew={() => setWriterTool('templates')} onDismiss={() => { setStartTabId(null); if (!tabCount) newBlankNote(); }} />}
          <div className={styles.tabStrip} hidden={focusMode}><Tabs /></div>
          <div className={styles.editorRow} ref={editorRowRef}>
            <div
              className={`${styles.editorPane} ${layout === 'preview' ? styles.hiddenPane : ''}`}
              aria-hidden={layout === 'preview'}
              style={layout === 'split' && editorRatio ? { flex: `${editorRatio} 1 0%` } : undefined}
            >
              <Suspense fallback={<div className={styles.lazyFallback}>{t("Loading editor…")}</div>}>
                <ErrorBoundary>
                  <EditorPane
                    onReady={api => {
                      editorApiRef.current = api;
                    }}
                    onShowProblems={() => { if (useTabsStore.getState().tabs.find(tab => tab.id === useTabsStore.getState().activeTabId)?.lang === 'latex') showProblems(); }}
                    onOpenInclude={(raw, kind, isImport) => {
                      const project = useProjectStore.getState();
                      const active = useTabsStore.getState();
                      const currentAbs =
                        active.tabs.find(t => t.id === active.activeTabId)?.filePath ?? null;
                      if (kind === 'latex-macro' || kind === 'latex-environment') {
                        const workspace = { rootPath: project.rootAbs, activePath: currentAbs, documents: [
                          ...project.files.filter(file => !file.binaryBase64 && !file.isBib).map(file => ({ path: file.absPath, language: 'latex' as const, text: file.content })),
                          ...active.tabs.filter(tab => tab.filePath).map(tab => ({ path: tab.filePath, language: tab.lang, text: tab.content })),
                        ] };
                        const activeText = active.tabs.find(tab => tab.id === active.activeTabId)?.content ?? '';
                        const declaration = kind === 'latex-macro'
                          ? latexWorkspaceMacros(workspace, activeText).get(raw)
                          : latexWorkspaceEnvironments(workspace, activeText).get(raw);
                        if (declaration?.sourcePath) {
                          const source = active.tabs.find(tab => pathsEqual(tab.filePath, declaration.sourcePath))?.content
                            ?? project.files.find(file => pathsEqual(file.absPath, declaration.sourcePath))?.content ?? '';
                          const line = (kind === 'latex-macro' ? latexMacroDeclarationLine(source, raw) : latexEnvironmentDeclarationLine(source, raw)) ?? 1;
                          void openFileAndScrollToLine(declaration.sourcePath, line, target => editorApiRef.current?.scrollToLine(target));
                        }
                        return;
                      }
                      const abs = kind === 'typst'
                        ? resolveTypstTarget(raw, currentAbs, project.files)
                        : resolveIncludeTarget(raw, currentAbs, project.files, isImport);
                      if (abs) void openFileByPath(abs);
                    }}
                  />
                </ErrorBoundary>
              </Suspense>
            </div>
            {layout === 'split' && <Splitter onDragStart={startEditorDrag} onDrag={dragEditor} onDragEnd={endEditorDrag} />}
            <div
              className={`${styles.previewPane} ${layout === 'editor' ? styles.hiddenPane : ''}`}
              aria-hidden={layout === 'editor'}
              style={layout === 'split' && editorRatio ? { flex: `${1 - editorRatio} 1 0%` } : undefined}
            >
              <Suspense fallback={<div className={styles.lazyFallback}>{t("Loading preview…")}</div>}>
                <ErrorBoundary>
                  {lang === 'latex' ? (
                    <PdfViewer
                      visible={layout !== 'editor'}
                      onCompile={compileNow}
                      onEnvironment={() => setWriterTool('environment')}
                      onProblems={showProblems}
                      onSyncTexBackward={(page, x, y) =>
                        syncTexBackwardFromPdf(page, x, y, (absPath, line) =>
                          void openFileAndScrollToLine(absPath, line, l =>
                            editorApiRef.current?.scrollToLine(l),
                          ),
                        )
                      }
                    />
                  ) : lang === 'typst' ? (
                    <PreviewPane onEnvironment={() => setWriterTool('environment')} visible={layout !== 'editor'} onNavigate={(path, line) => void openFileAndScrollToLine(path, line, l => editorApiRef.current?.scrollToLine(l))} />
                  ) : null}
                </ErrorBoundary>
              </Suspense>
            </div>
          </div>
        </div>
      </div>

      <StatusBar onToggleProblems={toggleProblems} />
      <LatexAutoCompile enabled={autoCompile && layout !== 'editor'} />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <QuickOpen
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        folder={workspaceFolder}
        onOpenFile={path => void openFileByPath(path)}
        onJumpToLine={line => { editorApiRef.current?.scrollToLine(line); editorApiRef.current?.focus(); }}
      />
      {writerTool && <WriterDialog key={writerTool} tool={writerTool} hidden={settingsOpen} onClose={() => setWriterTool(null)} onCreated={openCreatedProject} onBlank={newBlankNote} onSettings={() => setSettingsOpen(true)} />}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SaveConflictNotice />
      <WorkspaceSearchDialog
        open={workspaceSearchOpen}
        root={workspaceFolder}
        onClose={() => setWorkspaceSearchOpen(false)}
        onOpenMatch={(path, line) =>
          void openFileAndScrollToLine(path, line, target => editorApiRef.current?.scrollToLine(target))
        }
        dirtyPaths={dirtyPaths}
        onFilesChanged={paths => {
          if (paths.length) void checkExternalDocuments(true).catch(() => {});
          setFolderRefreshKey(key => key + 1);
        }}
      />

      <RenameReferenceDialog
        open={renameReferenceOpen}
        root={workspaceFolder}
        onClose={() => setRenameReferenceOpen(false)}
        onApplied={paths => {
          void (async () => {
            if (paths.length) await checkExternalDocuments(true).catch(() => {});
            refreshReferences();
          })();
        }}
      />
      <TableConvertDialog
        open={tableConvertOpen}
        lang={lang}
        onClose={() => setTableConvertOpen(false)}
        onInsert={text => editorApiRef.current?.insertAtCursor(text)}
      />

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
        onPickFolder={path => { void openWorkspaceFolder(path); }}
        onClear={() =>
          void useSettingsStore
            .getState()
            .patchAndSave({ recent_files: [], recent_folders: [] })
        }
      />
    </div>
  );
}

/** Compiles the active LaTeX document as it changes. A component of its own so
 *  only it, not the whole shell, follows the document text. */
function LatexAutoCompile({ enabled }: { enabled: boolean }) {
  const tab = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId));
  useLatexAutoCompile(tab, enabled);
  return null;
}
