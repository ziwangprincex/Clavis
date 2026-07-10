// Centralised, type-checked wrapper around Tauri's window.__TAURI__ API.
//
// Why not @tauri-apps/api? The legacy ui/ ships with `withGlobalTauri: true`
// (see tauri.conf.json) and uses `window.__TAURI__` directly. Sticking with
// the same surface keeps the IPC contract identical between the legacy panels
// (still in ui-legacy/) and the React panels during the migration window.
//
// As panels migrate, prefer importing the named functions from this module
// over reaching into `window.__TAURI__` directly — that way the entire IPC
// surface is type-checked in one place.

type InvokeArgs = Record<string, unknown> | undefined;

interface TauriGlobal {
  invoke: <T = unknown>(cmd: string, args?: InvokeArgs) => Promise<T>;
  event: {
    listen: <T = unknown>(
      event: string,
      handler: (payload: { event: string; payload: T }) => void,
    ) => Promise<() => void>;
    emit: (event: string, payload?: unknown) => Promise<void>;
  };
  app: {
    getVersion: () => Promise<string>;
  };
  dialog: {
    open: (opts?: unknown) => Promise<string | string[] | null>;
    save: (opts?: unknown) => Promise<string | null>;
    message: (msg: string, opts?: unknown) => Promise<void>;
    confirm: (msg: string, opts?: unknown) => Promise<boolean>;
  };
  updater: {
    checkUpdate: () => Promise<UpdateStatus>;
    installUpdate: () => Promise<void>;
  };
  process: {
    relaunch: () => Promise<void>;
  };
}

/** Result of updater.checkUpdate() (mirrors @tauri-apps/api/updater). */
export interface UpdateManifest {
  version: string;
  date?: string;
  body?: string;
}
export interface UpdateStatus {
  shouldUpdate: boolean;
  manifest?: UpdateManifest;
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

export function hasTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

function tauri(): TauriGlobal {
  const t = window.__TAURI__;
  if (!t) throw new Error('Tauri runtime not available (running outside the app shell?)');
  return t;
}

// ---------- Generic helpers ----------

export function invoke<T = unknown>(cmd: string, args?: InvokeArgs): Promise<T> {
  return tauri().invoke<T>(cmd, args);
}

export function listen<T = unknown>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  return tauri().event.listen<T>(event, e => handler(e.payload));
}

export function getAppVersion(): Promise<string> {
  return tauri().app.getVersion();
}

// ---------- Updater ----------

/** Ask the Tauri updater whether a newer signed release is available. */
export function checkUpdate(): Promise<UpdateStatus> {
  return tauri().updater.checkUpdate();
}

/** Download + verify + install the pending update (call after checkUpdate). */
export function installUpdate(): Promise<void> {
  return tauri().updater.installUpdate();
}

/** Relaunch the app (used after installUpdate to boot into the new version). */
export function relaunch(): Promise<void> {
  return tauri().process.relaunch();
}

// ---------- Dialog helpers ----------

export interface OpenDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

export function dialogOpen(opts?: OpenDialogOptions): Promise<string | string[] | null> {
  return tauri().dialog.open(opts);
}

export function dialogSave(opts?: SaveDialogOptions): Promise<string | null> {
  return tauri().dialog.save(opts);
}

/** Native yes/no confirmation dialog. Returns true if the user confirmed. */
export function dialogConfirm(message: string, opts?: { title?: string }): Promise<boolean> {
  return tauri().dialog.confirm(message, opts);
}

/** Native informational dialog (single OK button). */
export function dialogMessage(message: string, opts?: { title?: string }): Promise<void> {
  return tauri().dialog.message(message, opts);
}

// ---------- FS helpers ----------
//
// These route through Rust commands (read_text_file / write_text_file /
// path_exists) rather than Tauri's JS `fs` API. The `fs` allowlist has been
// removed from tauri.conf.json, so the webview has no direct filesystem
// capability — all reads/writes are auditable Rust commands. Paths still
// originate from user-driven open/save dialogs.

export const fs = {
  readTextFile: (path: string) => invoke<string>('read_text_file', { path }),
  writeTextFile: (path: string, contents: string) =>
    invoke<void>('write_text_file', { path, contents }),
  exists: (path: string) => invoke<boolean>('path_exists', { path }),
};

// ---------- Domain types ----------
//
// Kept loose on purpose — fields are added as panels are migrated and need
// the precision. The Rust side serialises with serde rename_all = "camelCase".

export interface ProjectFile {
  relPath: string;
  content: string;
  binaryBase64?: string | null;
}

export interface CompileOptions {
  source: string;
  engine: string;
  customPath?: string;
  bibEngine?: 'auto' | 'bibtex' | 'biber' | 'none';
  autoRerun?: boolean;
  maxRuns?: number;
  synctex?: boolean;
  workdirToken?: string | null;
  projectFiles?: ProjectFile[];
}

export interface LatexDiag {
  line: number | null;
  message: string;
  kind: string;
  /** Source file the diagnostic refers to (project-relative), if reported. */
  file?: string;
  package?: string;
}

export interface CompileResult {
  ok: boolean;
  pdfBase64?: string | null;
  errors: LatexDiag[];
  logTail: string;
  runs: number;
  workdirToken: string | null;
}

export interface BibEntry {
  key: string;
  entryType: string;
  title?: string;
  author?: string;
  year?: string;
  /** Absolute path of the .bib file this entry was parsed from. */
  sourceFile: string;
  /** 1-based line of the entry's `@type{...` within its .bib file. */
  sourceLine: number;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

// --- Multi-file project + SyncTeX + distro shapes (mirror the Rust structs;
//     serde serializes them camelCase). Kept precise so the IPC boundary is
//     type-checked — a loose `unknown` here is exactly what let the SyncTeX
//     `file` vs `inputFile` field-name bug slip through. ---

export interface CollectedFile {
  relPath: string;
  absPath: string;
  content: string;
  isBib: boolean;
  binaryBase64?: string | null;
}

export interface CollectResult {
  rootRel: string;
  files: CollectedFile[];
  warnings: string[];
}

export interface SyncTexHit {
  page: number;
  x: number;
  y: number;
  h: number;
  v: number;
  w: number;
  height: number;
}

export interface SyncTexEdit {
  line: number;
  column: number;
  inputFile: string;
}

export interface DistroInfo {
  name: string;
  manager: string;
  managerPath?: string | null;
  version?: string | null;
}

export interface AppSettings {
  // Loose for now; see settings.rs for the canonical shape.
  // Refined progressively as the Settings panel is migrated.
  [k: string]: unknown;
}

// ---------- Typed command bindings ----------

export const ipc = {
  // --- Settings ---
  getSettings: () => invoke<AppSettings>('get_settings'),
  setSettings: (settings: AppSettings) => invoke<void>('set_settings', { settings }),
  loadSession: () => invoke<string>('load_session'),
  saveSession: (data: string) => invoke<void>('save_session', { data }),
  detectLatexEngines: () => invoke<Record<string, string>>('detect_latex_engines'),
  detectBibEngines: () => invoke<Record<string, string>>('detect_bib_engines'),

  // --- LaTeX ---
  compileLatex: (opts: CompileOptions) => invoke<CompileResult>('compile_latex', { opts }),
  exportLatexPdf: (workdirToken: string, targetPath: string) =>
    invoke<void>('export_latex_pdf', { workdirToken, targetPath }),
  readLatexLog: (workdirToken: string) =>
    invoke<string>('read_latex_log', { workdirToken }),
  collectProjectFiles: (root: string) =>
    invoke<CollectResult>('collect_project_files', { root }),
  detectDistro: (enginePath?: string) =>
    invoke<DistroInfo>('detect_distro', { enginePath }),
  installPackage: (manager: string, name: string) =>
    invoke<void>('install_package', { manager, name }),
  parseBib: (bibPaths: string[]) =>
    invoke<BibEntry[]>('parse_bib', { bibPaths }),
  cleanupWorkdir: (workdirToken: string) =>
    invoke<void>('cleanup_workdir', { workdirToken }),
  synctexForward: (workdirToken: string, line: number, column: number) =>
    invoke<SyncTexHit>('synctex_forward', { workdirToken, line, column }),
  synctexBackward: (workdirToken: string, page: number, x: number, y: number) =>
    invoke<SyncTexEdit>('synctex_backward', { workdirToken, page, x, y }),

  // --- Typst ---
  compileTypst: (source: string, docPath?: string | null) =>
    invoke<{ ok: boolean; svg?: string; error?: string }>('compile_typst', { source, docPath }),
  compileTypstPdf: (source: string, docPath?: string | null) =>
    invoke<{ ok: boolean; pdfBase64?: string; error?: string }>('compile_typst_pdf', { source, docPath }),
  listTypstFonts: () => invoke<string[]>('list_typst_fonts'),

  // --- Filesystem ---
  scanFolderShallow: (root: string) => invoke<TreeNode>('scan_folder_shallow', { root }),
  saveBinaryFile: (path: string, base64: string) =>
    invoke<void>('save_binary_file', { path, base64 }),
};

// ---------- Event helpers ----------

export interface LatexLogPayload {
  run: number;
  stream: 'stdout' | 'stderr' | 'info';
  text: string;
}

export interface LatexRunStartPayload {
  run: number;
  command: string;
}

export const events = {
  onFileDrop: (handler: (paths: string[]) => void) =>
    listen<string[]>('tauri://file-drop', handler),
  onLatexLog: (handler: (p: LatexLogPayload) => void) =>
    listen<LatexLogPayload>('latex-log', handler),
  onLatexRunStart: (handler: (p: LatexRunStartPayload) => void) =>
    listen<LatexRunStartPayload>('latex-run-start', handler),
};
