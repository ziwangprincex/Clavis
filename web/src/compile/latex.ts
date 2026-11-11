import { ipc, events, fs, dialogConfirm, type CompileResult, type LatexDiag } from '../api/tauri';
import { useCompileStore, usePdfStore, useTabsStore, useSettingsStore, useProjectStore, type Tab } from '../store';
import { setStatus } from '../store/status';
import { pathsEqual } from '../files/projectPaths';
import { belongsToPdf, latexRoot } from './target';
import { latexOptions, workspaceFor } from './project';

/** The main file's text, for its magic comments: its open buffer, else the file. */
async function mainText(root: string, tabs: Tab[]): Promise<string> {
  return tabs.find(t => pathsEqual(t.filePath, root))?.content ?? await fs.readTextFile(root);
}

useTabsStore.subscribe(state => {
  const pdf = usePdfStore.getState();
  if (!pdf.bytes || pdf.stale) return;
  const changed = state.tabs.some(tab => {
    if (!pdf.sourceRoot) return tab.id === pdf.ownerTabId && tab.content !== pdf.sourceContent;
    const source = pdf.sourceFiles.find(file => pathsEqual(file.absPath, tab.filePath));
    return !!source && source.content !== tab.content;
  });
  if (changed) usePdfStore.setState({ stale: true, workdirToken: null });
});

let inFlight = false;
type BuildMode = 'normal' | 'quick' | 'clean' | 'full';
let pendingRerun: BuildMode | null = null;
let activeRequest: string | null = null;
let cancelled = false;
let nativeStarted = false;
export async function stopLatexCompile(): Promise<void> {
  cancelled = true;
  pendingRerun = null;
  if (activeRequest && nativeStarted) {
    try { await ipc.cancelLatexCompile(activeRequest); }
    catch (error) { setStatus(`Could not stop compilation: ${error}`, 'error'); }
  }
}

export async function runLatexCompile(mode: BuildMode = 'normal'): Promise<CompileResult | null> {
  if (inFlight) {
    pendingRerun = mode;
    return null;
  }
  const state = useTabsStore.getState();
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (!tab || tab.lang !== 'latex') return null;
  inFlight = true;
  cancelled = false;
  nativeStarted = false;
  activeRequest = `compile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const project = useProjectStore.getState();
  const root = latexRoot(tab, project);
  let context = { sourceRoot: root, sourceFiles: root && pathsEqual(root, project.rootAbs) ? project.files : [], ownerTabId: tab.id };
  const stillVisible = () => {
    const current = useTabsStore.getState();
    const active = current.tabs.find(t => t.id === current.activeTabId);
    return active?.lang === 'latex' && ((active.id === tab.id && pathsEqual(active.filePath, tab.filePath))
      || belongsToPdf(active, context));
  };
  const settings = useSettingsStore.getState().settings;
  const off: Array<() => void> = [];
  useCompileStore.getState().clearLog();
  useCompileStore.getState().setStatus('compiling');
  setStatus('Compiling…');
  // Keep the previous page visible while updating, but invalidate export/SyncTeX.
  // Failure preserves only the matching document image, never export/SyncTeX.
  const previousPdf = usePdfStore.getState();
  const previousBytes = belongsToPdf(tab, previousPdf) ? previousPdf.bytes : null;
  usePdfStore.setState({ bytes: previousBytes, workdirToken: null, stale: true });

  try {
    off.push(await events.onLatexLog(payload => useCompileStore.getState().appendLog(payload)));
    off.push(await events.onLatexRunStart(payload => useCompileStore.getState().appendLog({
      run: payload.run, stream: 'info', text: `\n--- run ${payload.run}: ${payload.command} ---\n`,
    })));

    const workspace = workspaceFor(tab, useProjectStore.getState().workspace);
    if (mode === 'full') {
      if (!workspace) throw new Error('Open the project folder before using latexmk.');
      if (!await dialogConfirm('Run a full latexmk build? A project .latexmkrc can execute local commands; continue only for a trusted project.', { title: 'Trust full build?' })) {
        usePdfStore.setState(previousPdf); setStatus('Build cancelled'); return null;
      }
      await ipc.setWorkspaceTrust(workspace.root, true);
    }
    if (cancelled) throw new Error('Compilation cancelled');
    const owner = state.tabs.find(t => root && pathsEqual(t.filePath, root)) ?? tab;
    // Build folders are owned by the main document, not whichever chapter is active.
    const token = owner.latexWorkdirToken;
    const resolvedOptions = latexOptions(tab, root ? await mainText(root, state.tabs) : tab.content);
    if (cancelled) throw new Error('Compilation cancelled');
    nativeStarted = true;
    // The backend reads the project from disk itself. It gets the open buffers
    // to compile in place of their files, without saving them.
    const built = await ipc.compileLatex({
      source: tab.content,
      rootPath: root,
      documents: root ? state.tabs.filter(t => t.filePath).map(t => ({ path: t.filePath!, content: t.content })) : [],
      sourceIdentity: tab.id,
      clean: mode === 'clean',
      ...resolvedOptions,
      requestId: activeRequest!,
      fullBuild: mode === 'full',
      workspaceRoot: workspace?.root,
      autoRerun: mode === 'quick' ? false : settings.auto_rerun,
      maxRuns: mode === 'quick' ? 1 : settings.max_runs,
      synctex: true,
    });
    const snapshot = built.snapshot ?? null;
    const files = snapshot?.files ?? [];
    const rootFile = files.find(file => pathsEqual(file.absPath, root));
    const source = rootFile?.content ?? tab.content;
    const sourceRoot = rootFile?.absPath ?? root;
    context = { sourceRoot, sourceFiles: files, ownerTabId: tab.id };
    if (snapshot && sourceRoot && latexRoot(tab, useProjectStore.getState()) === root) {
      useProjectStore.getState().setProject({
        rootAbs: sourceRoot, rootBasename: snapshot.rootRel, activeAbs: tab.filePath,
        files, warnings: snapshot.warnings,
      });
    }
    // The PDF comes separately, as raw bytes rather than base64 text.
    let pdfBytes: Uint8Array | null = null;
    let pdfError: LatexDiag | null = null;
    if (built.ok && !cancelled && built.workdirToken) {
      try {
        pdfBytes = await ipc.readBuildPdf(built.workdirToken);
      } catch (error) {
        pdfError = { line: null, message: `Could not read the PDF: ${error}`, kind: 'error' };
      }
    }
    // What the build amounts to here; the backend's answer is left as it came.
    const result: CompileResult = {
      ...built,
      ok: built.ok && !cancelled && pdfBytes !== null,
      errors: pdfError ? [...built.errors ?? [], pdfError] : built.errors ?? [],
    };
    if (token && token !== result.workdirToken) void ipc.cleanupWorkdir(token).catch(() => {});
    const ownerStillOpen = useTabsStore.getState().tabs.some(t => t.id === owner.id);
    if (result.workdirToken) {
      if (ownerStillOpen) {
        useTabsStore.getState().patchTab(owner.id, { latexWorkdirToken: result.workdirToken });
      } else {
        void ipc.cleanupWorkdir(result.workdirToken).catch(() => {});
      }
    }
    const current = useTabsStore.getState();
    const visible = stillVisible();
    if (!visible) {
      if (!belongsToPdf(current.tabs.find(t => t.id === current.activeTabId), usePdfStore.getState())) {
        usePdfStore.setState({ bytes: null, workdirToken: null });
      }
      useCompileStore.getState().setStatus('idle');
      setStatus('Ready');
      return result;
    }
    const buffersChanged = state.tabs.some(original => {
      if (!files.some(file => pathsEqual(file.absPath, original.filePath)) && original.id !== tab.id) return false;
      const currentTab = current.tabs.find(t => t.id === original.id);
      return currentTab && currentTab.content !== original.content;
    });
    useCompileStore.setState({
      errors: result.errors ?? [], logTail: result.logTail ?? '', runs: result.runs,
      chain: result.engine ? { engine: result.engine, bibTool: result.bibTool ?? null, runs: result.runs } : null,
      status: result.ok ? 'ok' : 'error',
    });
    usePdfStore.setState({
      ...context,
      sourceContent: source,
      bytes: result.ok ? pdfBytes : previousBytes,
      stale: !result.ok || buffersChanged,
      workdirToken: result.ok && ownerStillOpen && !buffersChanged ? result.workdirToken : null,
    });
    if (result.ok && result.pdfSaveError) setStatus(`PDF not saved: ${result.pdfSaveError}`, 'error');
    else setStatus(result.ok ? `Rendered (${result.runs} run${result.runs === 1 ? '' : 's'})` : 'Compile failed · details under Problems', result.ok ? 'ok' : 'error');
    return result;
  } catch (error) {
    // A late failure belongs to the document that started it, not the new tab.
    if (!stillVisible()) {
      useCompileStore.getState().setStatus('idle');
      setStatus('Ready');
      return null;
    }
    usePdfStore.setState({ bytes: previousBytes, workdirToken: null, stale: true });
    useCompileStore.getState().setStatus('error');
    useCompileStore.getState().setErrors([{ line: null, message: String(error), kind: 'error' }]);
    setStatus('Compile failed · details under Problems', 'error');
    return null;
  } finally {
    for (const dispose of off) { try { dispose(); } catch { /* Always release the compile guard. */ } }
    inFlight = false;
    activeRequest = null;
    nativeStarted = false;
    if (useCompileStore.getState().status === 'compiling') useCompileStore.getState().setStatus('idle');
    if (pendingRerun) {
      const next = pendingRerun;
      pendingRerun = null;
      void runLatexCompile(next);
    }
  }
}
