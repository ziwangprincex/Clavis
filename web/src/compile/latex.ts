import { ipc, events, type CompileResult } from '../api/tauri';
import { useCompileStore, usePdfStore, useTabsStore, useSettingsStore, useProjectStore } from '../store';
import { setStatus } from '../store/status';
import { pathsEqual } from '../files/projectPaths';
import { belongsToPdf, latexRoot } from './target';

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), char => char.charCodeAt(0));
}

let inFlight = false;
let pendingRerun = false;

export async function runLatexCompile(): Promise<CompileResult | null> {
  if (inFlight) {
    pendingRerun = true;
    return null;
  }
  const state = useTabsStore.getState();
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (!tab || tab.lang !== 'latex') return null;
  inFlight = true;
  const root = latexRoot(tab, useProjectStore.getState());
  const settings = useSettingsStore.getState().settings;
  const off: Array<() => void> = [];
  useCompileStore.getState().clearLog();
  useCompileStore.getState().setStatus('compiling');
  setStatus('Compiling…');
  // Keep the previous page visible while updating, but invalidate export/SyncTeX.
  // The viewer labels it as updating; failure explicitly clears it below.
  usePdfStore.setState({ workdirToken: null });

  try {
    off.push(await events.onLatexLog(payload => useCompileStore.getState().appendLog(payload)));
    off.push(await events.onLatexRunStart(payload => useCompileStore.getState().appendLog({
      run: payload.run, stream: 'info', text: `\n--- run ${payload.run}: ${payload.command} ---\n`,
    })));

    const collected = root ? await ipc.collectLatexSnapshot(root, state.tabs
      .filter(t => t.filePath)
      .map(t => ({ path: t.filePath!, content: t.content }))) : null;
    const rootFile = collected?.files.find(file => pathsEqual(file.absPath, root));
    if (root && !rootFile) throw new Error('Project main document was not found in the compile snapshot.');
    const source = rootFile?.content ?? tab.content;
    const files = collected?.files ?? [];
    const sourceRoot = rootFile?.absPath ?? root;
    const context = { sourceRoot, sourceFiles: files, ownerTabId: tab.id };
    const owner = state.tabs.find(t => root && pathsEqual(t.filePath, root)) ?? tab;
    // Workdirs are owned by the main document, not whichever chapter is active.
    const token = owner.latexWorkdirToken;
    if (collected && sourceRoot && latexRoot(tab, useProjectStore.getState()) === root) {
      useProjectStore.getState().setProject({
        rootAbs: sourceRoot, rootBasename: collected.rootRel, activeAbs: tab.filePath,
        files, warnings: collected.warnings,
      });
    }
    const result = await ipc.compileLatex({
      source,
      engine: settings.latex_engine,
      customPath: settings.latex_custom_paths[settings.latex_engine],
      bibEngine: settings.bib_engine as 'auto' | 'bibtex' | 'biber' | 'none',
      autoRerun: settings.auto_rerun,
      maxRuns: settings.max_runs,
      synctex: true,
      // Compile each source snapshot in a fresh directory. A removed include
      // must never be satisfied by an older project's materialized source.
      workdirToken: null,
      projectFiles: files.filter(file => !pathsEqual(file.absPath, sourceRoot)).map(file => ({
        relPath: file.relPath, content: file.content, binaryBase64: file.binaryBase64 ?? null,
      })),
    });
    if (token && token !== result.workdirToken) void ipc.cleanupWorkdir(token).catch(() => {});
    const ownerStillOpen = useTabsStore.getState().tabs.some(t => t.id === owner.id);
    if (result.workdirToken) {
      if (ownerStillOpen) {
        useTabsStore.getState().patchTab(owner.id, { latexWorkdirToken: result.workdirToken, projectRoot: root });
      } else {
        void ipc.cleanupWorkdir(result.workdirToken).catch(() => {});
      }
    }
    const current = useTabsStore.getState();
    const visible = belongsToPdf(current.tabs.find(t => t.id === current.activeTabId), context);
    if (!visible) {
      usePdfStore.setState({ bytes: null, workdirToken: null });
      useCompileStore.getState().setStatus('idle');
      setStatus('Ready');
      return result;
    }
    useCompileStore.setState({
      errors: result.errors ?? [], logTail: result.logTail ?? '', runs: result.runs,
      status: result.ok ? 'ok' : 'error',
    });
    usePdfStore.setState({
      ...context,
      bytes: result.ok && result.pdfBase64 ? base64ToBytes(result.pdfBase64) : null,
      workdirToken: result.ok && ownerStillOpen ? result.workdirToken : null,
    });
    setStatus(result.ok ? `Rendered (${result.runs} run${result.runs === 1 ? '' : 's'})` : 'Compile failed · see problems', result.ok ? 'ok' : 'error');
    return result;
  } catch (error) {
    usePdfStore.setState({ bytes: null, workdirToken: null });
    useCompileStore.getState().setStatus('error');
    useCompileStore.getState().setErrors([{ line: null, message: String(error), kind: 'error' }]);
    setStatus('Compile failed · see problems', 'error');
    return null;
  } finally {
    for (const dispose of off) { try { dispose(); } catch { /* Always release the compile guard. */ } }
    inFlight = false;
    if (pendingRerun) {
      pendingRerun = false;
      void runLatexCompile();
    }
  }
}
