// Compile orchestrator — runs `compile_latex` over IPC, streams logs into the
// compile store, and drops the resulting PDF bytes into the pdf store.
//
// Decoupled from React: callers (Toolbar / shortcut handlers / commands) just
// call runLatexCompile() with the active tab and current settings.

import { ipc, events, type CompileResult, type LatexLogPayload, type LatexRunStartPayload } from '../api/tauri';
import {
  useCompileStore,
  usePdfStore,
  useTabsStore,
  useSettingsStore,
  useProjectStore,
} from '../store';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let inFlight = false;
let pendingRerun = false;

export async function runLatexCompile(): Promise<CompileResult | null> {
  // Coalesce: if a compile is already running, mark that a fresh run is wanted
  // and return. When the current run finishes, it re-invokes itself once with
  // the latest content. This turns "typed while compiling → dropped" into
  // "typed while compiling → one more compile with the newest text".
  if (inFlight) {
    pendingRerun = true;
    return null;
  }
  inFlight = true;

  const tabs = useTabsStore.getState();
  const settings = useSettingsStore.getState().settings;
  const project = useProjectStore.getState();
  const compileStore = useCompileStore.getState();
  const pdfStore = usePdfStore.getState();

  const tab = tabs.tabs.find(t => t.id === tabs.activeTabId);
  if (!tab || tab.lang !== 'latex') {
    inFlight = false;
    pendingRerun = false;
    return null;
  }

  compileStore.clearLog();
  compileStore.setStatus('compiling');

  // Wire streaming log + run-start events.
  const offLog = await events.onLatexLog((p: LatexLogPayload) => {
    useCompileStore.getState().appendLog(p);
  });
  const offRun = await events.onLatexRunStart((p: LatexRunStartPayload) => {
    useCompileStore.getState().appendLog({
      run: p.run,
      stream: 'info',
      text: `\n--- run ${p.run}: ${p.command} ---\n`,
    });
  });

  // Build project_files from useProjectStore (excluding the root which goes
  // via `source`).
  const projectFiles = project.rootAbs
    ? project.files
        .filter(f => f.absPath !== project.rootAbs)
        .map(f => ({
          relPath: f.relPath,
          content: f.content,
          binaryBase64: f.binaryBase64 ?? null,
        }))
    : [];

  try {
    const result = await ipc.compileLatex({
      source: tab.content,
      engine: settings.latex_engine,
      customPath: settings.latex_custom_paths[settings.latex_engine],
      bibEngine: settings.bib_engine as 'auto' | 'bibtex' | 'biber' | 'none',
      autoRerun: settings.auto_rerun,
      maxRuns: settings.max_runs,
      synctex: true,
      workdirToken: tab.latexWorkdirToken ?? null,
      projectFiles,
    });

    // Persist diagnostics.
    useCompileStore.getState().setErrors(result.errors ?? []);
    useCompileStore.getState().setLogTail(result.logTail ?? '');
    useCompileStore.getState().setRuns(result.runs);
    useCompileStore.getState().setStatus(result.ok ? 'ok' : 'error');

    // Cleanup an old workdir if Rust handed back a different token.
    if (tab.latexWorkdirToken && result.workdirToken && tab.latexWorkdirToken !== result.workdirToken) {
      ipc.cleanupWorkdir(tab.latexWorkdirToken).catch(() => {});
    }

    // Save the new token on the tab.
    if (result.workdirToken) {
      useTabsStore.getState().patchTab(tab.id, { latexWorkdirToken: result.workdirToken });
      pdfStore.setWorkdirToken(result.workdirToken);
    }

    // Decode PDF bytes if present.
    if (result.ok && result.pdfBase64) {
      pdfStore.setBytes(base64ToBytes(result.pdfBase64));
    }

    return result;
  } catch (e) {
    useCompileStore.getState().setStatus('error');
    useCompileStore.getState().setErrors([
      { line: null, message: String(e), kind: 'error' },
    ]);
    return null;
  } finally {
    offLog();
    offRun();
    inFlight = false;
    // If new content arrived mid-flight, run once more with the latest text.
    if (pendingRerun) {
      pendingRerun = false;
      // Fire-and-forget: caller of the outer invocation already received its
      // result; this second run pushes the fresh PDF into the store when done.
      void runLatexCompile();
    }
  }
}
