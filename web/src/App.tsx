import { t } from './i18n';
import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { hasTauri, dialogOpen, dialogSave, dialogConfirm } from './api/tauri';
import { useSettingsStore, useTabsStore, useProjectStore, usePdfStore, useStatusStore, useTaskStore, useReferencesStore, useArtifactsStore, useAssetsStore, useWritingStore, useGitStore, type Lang, newTabId } from './store';
import { useCommandsStore } from './store/commands';
import { fmtShortcut, isMac } from './platform';
import { Toolbar } from './components/Toolbar';
import { WriterDialog, type WriterTool } from './components/WriterDialog';
import { TitleBar } from './components/TitleBar';
import { StatusBar } from './components/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { SettingsDialog } from './components/SettingsDialog';
import { LogPanel } from './components/LogPanel';
import { TaskPanel } from './components/TaskPanel';
import { ProjectDoctorDialog } from './components/ProjectDoctorDialog';
import { WorkspaceSearchDialog } from './components/WorkspaceSearchDialog';
import { Tabs } from './components/Tabs';
import { Sidebar } from './components/Sidebar';
import { OutlineSection } from './components/OutlineSection';
import { FolderTreeSection } from './components/FolderTreeSection';
import { FilesSection } from './components/FilesSection';
import { BibSection } from './components/BibSection';
import { ReferencesSection } from './components/ReferencesSection';
import { ArtifactsSection } from './components/ArtifactsSection';
import { AssetsSection } from './components/AssetsSection';
import { WritingSection } from './components/WritingSection';
import { GitSection } from './components/GitSection';
import { SubmissionCheckDialog } from './components/SubmissionCheckDialog';
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
import { inspectAndMaybeTrustWorkspace } from './project/workspace';
import { isQuartoDocument } from './files/documentIdentity';
import { writingPolicyFromConfig } from './writing/options';
import { latexEnvironmentDeclarationLine, latexMacroDeclarationLine, latexWorkspaceEnvironments, latexWorkspaceMacros } from './completions/latexMacroScan';
import { isRenderableDocument, newestArtifact, startRender, type DocumentFormat, type DocumentTool, type RenderContext } from './documentTools/render';
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
  const [markdownJump, setMarkdownJump] = useState<{ tabId: string; line: number; seq: number } | null>(null);
  const loadSettings = useSettingsStore(s => s.load);
  const settings = useSettingsStore(s => s.settings);
  const patchAndSave = useSettingsStore(s => s.patchAndSave);

  const tabs = useTabsStore(s => s.tabs);
  const activeTabId = useTabsStore(s => s.activeTabId);
  const addTab = useTabsStore(s => s.addTab);
  const activeTab = tabs.find(t => t.id === activeTabId);
  const lang: Lang = activeTab?.lang ?? 'markdown';
  const workspaceInspection = useProjectStore(s => s.workspace);
  const taskStatus = useTaskStore(s => s.status);
  const taskPanelOpen = taskStatus !== 'idle';

  const [focusMode, setFocusMode] = useState(false);
  const layout = focusMode ? 'editor' : settings.editor_layout;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [writerTool, setWriterTool] = useState<WriterTool | null>(null);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const [renameReferenceOpen, setRenameReferenceOpen] = useState(false);
  const [tableConvertOpen, setTableConvertOpen] = useState(false);
  const [submissionCheckOpen, setSubmissionCheckOpen] = useState(false);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [autoCompile, setAutoCompile] = useState(true);
  const setStatus = useStatusStore(s => s.set);

  const editorApiRef = useRef<EditorPaneRef | null>(null);
  const workspaceOpenSeqRef = useRef(0);
  const pendingRenderRef = useRef<RenderContext | null>(null);

  const [workspaceFolder, setWorkspaceFolder] = useState<string | null>(null);
  const [folderRefreshKey, setFolderRefreshKey] = useState(0);

  // Pane widths + drag handlers (owns mainRef / workAreaRef).
  const {
    mainRef,
    workAreaRef,
    editorRowRef,
    sidebarWidth,
    editorRatio,
    logHeight,
    startSidebarDrag,
    dragSidebar,
    endSidebarDrag,
    startEditorDrag,
    dragEditor,
    endEditorDrag,
    startLogDrag,
    dragLog,
    endLogDrag,
  } = usePaneLayout(settings, layout);

  // Apply UI theme / fonts / accent / color overrides to :root.
  useAppTheme(settings);

  // Boot: load persisted settings, then restore the previous session (crash
  // recovery). If there's nothing to restore, open a single empty scratch tab
  // (not the old three Welcome samples) so the editor is ready to type in.
  useEffect(() => {
    if (hasTauri()) loadSettings();
    if (useTabsStore.getState().tabs.length > 0) return;

    function seedScratchTab() {
      useTabsStore.getState().addTab({
        id: newTabId(),
        title: 'Untitled.md',
        filePath: null,
        lang: 'markdown',
        content: '',
        isDirty: false,
      });
    }

    void (async () => {
      const restored = hasTauri() ? await restoreSession() : false;
      if (!restored && useTabsStore.getState().tabs.length === 0) {
        seedScratchTab();
      }
    })();
  }, [loadSettings, addTab]);

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
  // opt-in disk-autosave interval.
  useSessionPersistence(settings.autosave_enabled);
  useDocumentSync();

  function refreshReferences(root = workspaceFolder) {
    if (!root || !hasTauri()) return;
    void useReferencesStore.getState().refresh(root, useTabsStore.getState().tabs);
  }

  function refreshArtifacts(root = workspaceFolder) {
    if (!root || !hasTauri()) return;
    void useArtifactsStore.getState().refresh(root);
  }

  function refreshAssets(root = workspaceFolder) {
    if (!root || !hasTauri()) return;
    void useAssetsStore.getState().refresh(root, useTabsStore.getState().tabs);
  }

  function refreshWriting() {
    const policy = writingPolicyFromConfig(useProjectStore.getState().workspace?.config);
    useWritingStore.getState().refresh(useTabsStore.getState().tabs, policy);
  }

  function refreshGit(root = workspaceFolder) {
    if (!root || !hasTauri()) return;
    void useGitStore.getState().refresh(root);
  }

  // Set the workspace folder, inspect optional clavis.toml metadata, and ask
  // before granting execution trust. Inspection never runs project commands.
  async function openWorkspaceFolder(path: string) {
    if (useTaskStore.getState().status === 'running') {
      const stop = await dialogConfirm(
        'A project task is still running. Stop it before opening another workspace?',
        { title: 'Stop running task?' },
      );
      if (!stop) return;
      await useTaskStore.getState().cancel();
    }
    const openSeq = ++workspaceOpenSeqRef.current;
    setWorkspaceFolder(path);
    useProjectStore.getState().setProject({ workspace: null });
    void pushRecentFolder(path);
    if (!hasTauri()) return;

    try {
      const workspace = await inspectAndMaybeTrustWorkspace(
        path,
        ipc,
        inspection =>
          openSeq === workspaceOpenSeqRef.current
            ? dialogConfirm(
                `This workspace defines ${Object.keys(inspection.config?.tasks ?? {}).length} task(s) that can run local commands.\n\nTrust this workspace? No command will run until you start a task.`,
                { title: 'Trust workspace?' },
              )
            : Promise.resolve(false),
      );
      if (openSeq !== workspaceOpenSeqRef.current) return;
      useProjectStore.getState().setProject({ workspace });
      refreshReferences(workspace.root);
      refreshAssets(workspace.root);
      refreshWriting();
      refreshGit(workspace.root);
      if (workspace.config) refreshArtifacts(workspace.root);
      else useArtifactsStore.getState().clear();
      if (workspace.issues.length > 0) {
        setStatus(`Project config: ${workspace.issues[0]}`, 'error');
      } else if (workspace.trust === 'untrusted') {
        setStatus('Workspace opened without task execution trust', 'info');
      }
    } catch (error) {
      console.warn('workspace inspection failed', error);
      setStatus('Workspace opened; project config could not be inspected', 'error');
    }
  }

  async function closeWorkspaceFolder() {
    if (useTaskStore.getState().status === 'running') {
      const stop = await dialogConfirm(
        'A project task is still running. Stop it and close the workspace?',
        { title: 'Stop running task?' },
      );
      if (!stop) return;
      await useTaskStore.getState().cancel();
    }
    workspaceOpenSeqRef.current += 1;
    setWorkspaceFolder(null);
    useProjectStore.getState().setProject({ workspace: null });
    useReferencesStore.getState().clear();
    useArtifactsStore.getState().clear();
    useAssetsStore.getState().clear();
    useWritingStore.getState().clear();
    useGitStore.getState().clear();
  }

  // OS file-drop: files open, folders become the workspace.
  useFileDrop(path => { void openWorkspaceFolder(path); });

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

  useLatexAutoCompile(activeTab, autoCompile && layout !== 'editor');

  useEffect(() => {
    const timer = window.setTimeout(() => refreshWriting(), 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  useEffect(() => {
    if (!pendingRenderRef.current) return;
    if (taskStatus === 'ok') void openLatestRenderArtifact();
    else if (taskStatus === 'error' || taskStatus === 'cancelled') pendingRenderRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskStatus]);

  useEffect(() => {
    if (!workspaceFolder || !workspaceInspection?.config || !['ok', 'error', 'cancelled'].includes(taskStatus)) return;
    refreshArtifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskStatus, workspaceFolder, workspaceInspection]);

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
          setStatus('Preview changed during export. Please export again after compilation finishes.', 'error');
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

  async function renderCurrentDocument(tool: DocumentTool, format: DocumentFormat) {
    const tab = useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId);
    if (!workspaceFolder || !tab || !isRenderableDocument(tab) || !tab.filePath) {
      setStatus('Open a saved .qmd or .md Document inside a Workspace first', 'error');
      return;
    }
    const context: RenderContext = { root: workspaceFolder, document: tab.filePath, tool, format };
    try {
      pendingRenderRef.current = context;
      await startRender(context, tab);
    } catch (error) {
      pendingRenderRef.current = null;
      setStatus(String(error), 'error');
    }
  }

  async function openLatestRenderArtifact() {
    const context = pendingRenderRef.current;
    if (!context) return;
    try {
      const artifact = await newestArtifact(context);
      if (!artifact) {
        setStatus(`Render finished, but no ${context.format.toUpperCase()} artifact was found`, 'error');
        return;
      }
      await ipc.openDocumentArtifact(context.root, artifact.path);
      setStatus(`Opened ${artifact.relativePath}`, 'ok');
    } catch (error) {
      setStatus(`Could not open rendered artifact: ${String(error)}`, 'error');
    } finally {
      pendingRenderRef.current = null;
      setFolderRefreshKey(key => key + 1);
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
          `This runs an external command that downloads and installs software on your system.`,
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
      reg({ id: 'view.sidebar', name: 'Toggle sidebar', run: () => { setFocusMode(false); void patchAndSave({ sidebar_visible: !useSettingsStore.getState().settings.sidebar_visible }); } }),
      ...(['editor', 'split', 'preview'] as const).map(layout => reg({ id: `view.${layout}`, name: layout === 'editor' ? t("Editor only") : layout === 'preview' ? t("Preview only") : t("Split view"), run: () => { setFocusMode(false); void patchAndSave({ editor_layout: layout }); } })),
      reg({ id: 'file.open', name: 'Open file…', shortcut: fmtShortcut('Ctrl+O'), run: () => openFileDialog() }),
      reg({ id: 'file.save', name: 'Save', shortcut: fmtShortcut('Ctrl+S'), run: () => saveActiveTab() }),
      reg({ id: 'file.saveAs', name: 'Save as…', shortcut: fmtShortcut('Ctrl+Shift+S'), run: () => saveActiveTab({ saveAs: true }) }),
      reg({ id: 'workspace.openFolder', name: 'Open folder…', shortcut: fmtShortcut('Ctrl+Shift+O'), run: openFolder }),
      reg({
        id: 'workspace.closeFolder',
        name: 'Close folder',
        when: () => workspaceFolder !== null,
        run: () => closeWorkspaceFolder(),
      }),
      reg({
        id: 'workspace.refreshFolder',
        name: 'Refresh folder',
        when: () => workspaceFolder !== null,
        run: () => setFolderRefreshKey(k => k + 1),
      }),
      ...Object.keys(workspaceInspection?.config?.tasks ?? {}).map(task =>
        reg({
          id: `task.run.${task}`,
          name: `Run project task: ${task}`,
          when: () => {
            const workspace = useProjectStore.getState().workspace;
            return workspace?.trust === 'trusted' && useTaskStore.getState().status !== 'running';
          },
          run: async () => {
            try {
              await useTaskStore.getState().start(task);
            } catch (error) {
              setStatus(String(error), 'error');
            }
          },
        }),
      ),
      reg({
        id: 'task.cancel',
        name: 'Stop running project task',
        when: () => useTaskStore.getState().status === 'running',
        run: () => useTaskStore.getState().cancel(),
      }),
      reg({
        id: 'workspace.submission.check',
        name: 'Run Submission Check',
        when: () => workspaceFolder !== null,
        run: () => setSubmissionCheckOpen(true),
      }),
      reg({
        id: 'workspace.git.refresh',
        name: 'Refresh Git Status',
        when: () => workspaceFolder !== null,
        run: () => refreshGit(),
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
        id: 'workspace.artifacts.refresh',
        name: 'Refresh Generated Artifacts',
        when: () => workspaceFolder !== null,
        run: () => refreshArtifacts(),
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
      reg({
        id: 'workspace.doctor',
        name: 'Run Project Doctor',
        when: () => useProjectStore.getState().workspace !== null,
        run: () => setDoctorOpen(true),
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
      // The status-bar chip only appears when there ARE problems, so without a
      // palette entry a user who closes the panel on a clean compile has no way
      // to reopen it — and the setting persists to disk. This is the safety net.
      // It also gets back the raw compile log, which is the only thing to look
      // at when a compile fails in a way the diagnostic parser didn't catch.
      reg({
        id: 'view.toggleProblems',
        name: 'Toggle problems panel (LaTeX)',
        when: () => lang === 'latex',
        run: () =>
          void patchAndSave({
            problems_panel_open: !useSettingsStore.getState().settings.problems_panel_open,
          }),
      }),
      reg({ id: 'lang.markdown', name: 'Switch to Markdown', run: () => setLang('markdown') }),
      reg({ id: 'lang.latex', name: 'Switch to LaTeX', run: () => setLang('latex') }),
      reg({ id: 'lang.typst', name: 'Switch to Typst', run: () => setLang('typst') }),
      ...(['html', 'pdf', 'docx'] as const).map(format =>
        reg({
          id: `quarto.render.${format}`,
          name: `Quarto: Render ${format.toUpperCase()}`,
          when: () => isQuartoDocument(useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId)?.filePath)
            && useTaskStore.getState().status !== 'running',
          run: () => renderCurrentDocument('quarto', format),
        }),
      ),
      ...(['html', 'pdf', 'docx'] as const).map(format =>
        reg({
          id: `pandoc.render.${format}`,
          name: `Pandoc: Export ${format.toUpperCase()}`,
          when: () => isRenderableDocument(useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId))
            && useTaskStore.getState().status !== 'running',
          run: () => renderCurrentDocument('pandoc', format),
        }),
      ),
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
  }, [workspaceFolder, workspaceInspection, activeTab?.id, lang, taskStatus]);

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
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (workspaceFolder) setWorkspaceSearchOpen(true);
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
      } else if (mod && e.altKey && e.code === 'KeyJ' && lang === 'latex') {
        e.preventDefault();
        void syncTexForwardFromEditor(editorApiRef.current?.cursorLine() ?? 1);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (lang === 'latex') void exportLatexPdf();
        else if (lang === 'typst') void exportTypstPdf();
      } else if (isMac && e.metaKey && !e.shiftKey && !e.altKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  return (
    <div className={`${styles.app} ${focusMode ? styles.focusMode : ''}`} data-layout={layout}>
      <TitleBar>
      <Toolbar
        focusMode={focusMode}
        onToggleFocus={() => setFocusMode(value => !value)}
        layout={layout}
        onLayoutChange={next => { setFocusMode(false); void patchAndSave({ editor_layout: next }); }}
        sidebarVisible={!focusMode && settings.sidebar_visible}
        onToggleSidebar={() => { setFocusMode(false); void patchAndSave({ sidebar_visible: focusMode || !settings.sidebar_visible }); }}
        lang={lang}
        onLangChange={setLang}
        latexEngine={(() => { try { return activeTab ? latexOptions(activeTab, tabs.find(t => t.filePath === documentRoot(activeTab))?.content ?? activeTab.content).engine : settings.latex_engine; } catch { return settings.latex_engine; } })()}
        onLatexEngineChange={engine => { if (activeTab) { const owner = tabs.find(t => t.filePath === documentRoot(activeTab)) ?? activeTab; useTabsStore.getState().patchTab(owner.id, { latexEngineOverride: engine }); } }}
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
        onOpenFile={openFileDialog}
        onOpenFolder={openFolder}
        onSave={() => saveActiveTab()}
        onToggleRecent={() => setRecentOpen(o => !o)}
        onToggleSymbols={() => setSymbolsOpen(o => !o)}
        onWriterTool={setWriterTool}
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
          outline={
            <OutlineSection
              onJumpTo={(absPath, line) => {
                if (layout === 'preview') {
                  if (lang === 'markdown') setMarkdownJump({ tabId: activeTab?.id ?? '', line, seq: Date.now() });
                  else if (lang === 'typst') useTypstPreviewStore.getState().requestJump(absPath ?? activeTab?.filePath ?? null, line);
                  else void openFileAndScrollToLine(absPath, line, l => { void syncTexForwardFromEditor(l); });
                } else void openFileAndScrollToLine(absPath, line, l => editorApiRef.current?.scrollToLine(l));
              }}
            />
          }
          folderTree={
            <FolderTreeSection
              rootPath={workspaceFolder}
              onOpenFolder={openFolder}
              onCloseFolder={() => { void closeWorkspaceFolder(); }}
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
          artifacts={workspaceFolder && workspaceInspection?.config ? (
            <ArtifactsSection
              root={workspaceFolder}
              onRefresh={() => refreshArtifacts()}
              onRunTask={task => {
                void useTaskStore.getState().start(task).catch(error => setStatus(String(error), 'error'));
              }}
            />
          ) : null}
          writing={tabs.length > 0 ? (
            <WritingSection
              policy={writingPolicyFromConfig(workspaceInspection?.config)}
              onRefresh={() => refreshWriting()}
              onActivate={(path, line) =>
                void openFileAndScrollToLine(path, line, target => editorApiRef.current?.scrollToLine(target))
              }
            />
          ) : null}
          git={workspaceFolder ? <GitSection root={workspaceFolder} onRefresh={() => refreshGit()} /> : null}
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
          references={workspaceFolder ? (
            <ReferencesSection
              onRefresh={() => refreshReferences()}
              onActivate={(path, line) =>
                void openFileAndScrollToLine(path, line, target => editorApiRef.current?.scrollToLine(target))
              }
            />
          ) : null}
          bibliography={workspaceFolder ? (
            <BibSection
              onInsertCites={keys => editorApiRef.current?.insertCites(keys)}
              onJumpToSource={(absPath, line) =>
                void openFileAndScrollToLine(absPath, line, l =>
                  editorApiRef.current?.scrollToLine(l),
                )
              }
              onExportChanged={() => refreshReferences()}
            />
          ) : null}
        />
        {!focusMode && settings.sidebar_visible && (
          <Splitter onDragStart={startSidebarDrag} onDrag={dragSidebar} onDragEnd={endSidebarDrag} />
        )}

        <div className={styles.workArea} ref={workAreaRef}>
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
                      onSyncTexBackward={(page, x, y) =>
                        syncTexBackwardFromPdf(page, x, y, (absPath, line) =>
                          void openFileAndScrollToLine(absPath, line, l =>
                            editorApiRef.current?.scrollToLine(l),
                          ),
                        )
                      }
                    />
                  ) : (
                    <PreviewPane markdownJump={markdownJump} onEnvironment={() => setWriterTool('environment')} visible={layout !== 'editor'} onNavigate={(path, line) => void openFileAndScrollToLine(path, line, l => editorApiRef.current?.scrollToLine(l))} />
                  )}
                </ErrorBoundary>
              </Suspense>
            </div>
          </div>
          {!focusMode && (taskPanelOpen || (lang === 'latex' && settings.problems_panel_open)) && (
            <>
              <Splitter
                orientation="vertical"
                onDragStart={startLogDrag}
                onDrag={dragLog}
                onDragEnd={endLogDrag}
              />
              <div
                className={styles.logArea}
                style={logHeight ? { height: `${logHeight}px` } : undefined}
              >
                {taskPanelOpen ? (
                  <TaskPanel />
                ) : (
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
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <StatusBar
        onToggleProblems={() => {
          setFocusMode(false);
          void patchAndSave({ problems_panel_open: !settings.problems_panel_open });
        }}
      />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {writerTool && <WriterDialog tool={writerTool} onClose={() => setWriterTool(null)} />}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ProjectDoctorDialog
        open={doctorOpen}
        workspace={workspaceInspection}
        onClose={() => setDoctorOpen(false)}
      />
      <SaveConflictNotice />
      <WorkspaceSearchDialog
        open={workspaceSearchOpen}
        root={workspaceFolder}
        onClose={() => setWorkspaceSearchOpen(false)}
        onOpenMatch={(path, line) =>
          void openFileAndScrollToLine(path, line, target => editorApiRef.current?.scrollToLine(target))
        }
        dirtyPaths={tabs.filter(tab => tab.isDirty && tab.filePath).map(tab => tab.filePath!)}
        onFilesChanged={paths => {
          if (paths.length) void checkExternalDocuments(true).catch(() => {});
          setFolderRefreshKey(key => key + 1);
        }}
      />

      <RenameReferenceDialog
        open={renameReferenceOpen}
        root={workspaceFolder}
        tabs={tabs}
        onClose={() => setRenameReferenceOpen(false)}
        onApplied={paths => {
          void (async () => {
            if (paths.length) await checkExternalDocuments(true).catch(() => {});
            refreshReferences();
          })();
        }}
      />      <TableConvertDialog
        open={tableConvertOpen}
        lang={lang}
        onClose={() => setTableConvertOpen(false)}
        onInsert={text => editorApiRef.current?.insertAtCursor(text)}
      />

      <SubmissionCheckDialog
        open={submissionCheckOpen}
        root={workspaceFolder}
        tabs={tabs}
        onClose={() => setSubmissionCheckOpen(false)}
        onActivate={(path, line) =>
          void openFileAndScrollToLine(path, line, target => editorApiRef.current?.scrollToLine(target))
        }
      />      <SymbolsPanel
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
