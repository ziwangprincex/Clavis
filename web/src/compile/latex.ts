import { ipc, events, dialogConfirm, type CompileResult } from '../api/tauri';
import { useCompileStore, usePdfStore, useTabsStore, useSettingsStore, useProjectStore } from '../store';
import { setStatus } from '../store/status';
import { pathsEqual } from '../files/projectPaths';
import { belongsToPdf, latexRoot } from './target';
import { latexOptions, workspaceFor } from './project';

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), char => char.charCodeAt(0));
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

    let workspace = workspaceFor(tab, useProjectStore.getState().workspace);
    if (mode === 'full') {
      if (!workspace) throw new Error('Open the project folder before using latexmk.');
      if (!await dialogConfirm('Run a full latexmk build? A project .latexmkrc can execute local commands. Only continue for a project you trust.', { title: 'Trust full build?' })) {
        usePdfStore.setState(previousPdf); setStatus('Build cancelled'); return null;
      }
      const trust = await ipc.setWorkspaceTrust(workspace.root, true);
      workspace = { ...workspace, trust: trust.trust };
      useProjectStore.getState().setProject({ workspace });
    }
    if (cancelled) throw new Error('Compilation cancelled');
    const collected = root ? await ipc.collectLatexSnapshot(root, state.tabs
      .filter(t => t.filePath)
      .map(t => ({ path: t.filePath!, content: t.content }))) : null;
    const rootFile = collected?.files.find(file => pathsEqual(file.absPath, root));
    if (root && !rootFile) throw new Error('Project main document was not found in the compile snapshot.');
    const source = rootFile?.content ?? tab.content;
    const files = collected?.files ?? [];
    const sourceRoot = rootFile?.absPath ?? root;
    context = { sourceRoot, sourceFiles: files, ownerTabId: tab.id };
    const owner = state.tabs.find(t => root && pathsEqual(t.filePath, root)) ?? tab;
    // Workdirs are owned by the main document, not whichever chapter is active.
    const token = owner.latexWorkdirToken;
    if (collected && sourceRoot && latexRoot(tab, useProjectStore.getState()) === root) {
      useProjectStore.getState().setProject({
        rootAbs: sourceRoot, rootBasename: collected.rootRel, activeAbs: tab.filePath,
        files, warnings: collected.warnings,
      });
    }
    if (cancelled) throw new Error('Compilation cancelled');
    const resolvedOptions = latexOptions(tab, source);
    nativeStarted = true;
    const result = await ipc.compileLatex({
      source,
      ...resolvedOptions,
      sourceIdentity: sourceRoot ?? tab.id,
      cacheToken: mode === 'clean' ? null : token,
      requestId: activeRequest!,
      fullBuild: mode === 'full',
      workspaceRoot: workspace?.root,
      autoRerun: mode === 'quick' ? false : settings.auto_rerun,
      maxRuns: mode === 'quick' ? 1 : settings.max_runs,
      synctex: true,
      // Compile each source snapshot in a fresh directory. A removed include
      // must never be satisfied by an older project's materialized source.
      workdirToken: null,
      projectFiles: files.filter(file => !pathsEqual(file.absPath, sourceRoot)).map(file => ({
        relPath: file.relPath, content: file.content, binaryBase64: file.binaryBase64 ?? null,
      })),
    });
    if (cancelled) result.ok = false;
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
      status: result.ok ? 'ok' : 'error',
    });
    usePdfStore.setState({
      ...context,
      sourceContent: source,
      bytes: result.ok && result.pdfBase64 ? base64ToBytes(result.pdfBase64) : previousBytes,
      stale: !result.ok || buffersChanged,
      workdirToken: result.ok && ownerStillOpen && !buffersChanged ? result.workdirToken : null,
    });
    setStatus(result.ok ? `Rendered (${result.runs} run${result.runs === 1 ? '' : 's'})` : 'Compile failed · see problems', result.ok ? 'ok' : 'error');
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
    setStatus('Compile failed · see problems', 'error');
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
