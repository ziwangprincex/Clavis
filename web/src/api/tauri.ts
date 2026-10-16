// Centralised, type-checked wrapper around Tauri's window.__TAURI__ API.
//
// The app is built with `withGlobalTauri: true` (see tauri.conf.json), so the
// runtime is reached through `window.__TAURI__` rather than @tauri-apps/api.
// Import the named functions from this module instead of touching
// `window.__TAURI__` directly — that way the entire IPC surface is
// type-checked in one place.

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
  window: {
    appWindow: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      unmaximize: () => Promise<void>;
      toggleMaximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      onResized: (
        handler: (e: { event: string; payload: unknown }) => void,
      ) => Promise<() => void>;
    };
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

/** Broadcasts an event to every window of the app. */
export function emit(event: string, payload?: unknown): Promise<void> {
  return tauri().event.emit(event, payload);
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

// ---------- Window controls ----------
//
// Only reachable when `hasTauri()` — in browser preview these throw. Callers
// (TitleBar) MUST guard with hasTauri(); an unguarded throw inside a React
// effect black-screens the whole app (previously bit us via getAppVersion in
// SettingsDialog).

export const appWindow = {
  minimize: () => tauri().window.appWindow.minimize(),
  toggleMaximize: () => tauri().window.appWindow.toggleMaximize(),
  close: () => tauri().window.appWindow.close(),
  isMaximized: () => tauri().window.appWindow.isMaximized(),
  /** Subscribe to native window-resize events. Returns an unlisten fn. */
  onResized: (handler: () => void) =>
    tauri().window.appWindow.onResized(() => handler()),
};

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
export function dialogConfirm(message: string, opts?: { title?: string; okLabel?: string; cancelLabel?: string }): Promise<boolean> {
  return tauri().dialog.confirm(message, opts);
}

/** Native informational dialog (single OK button). */
export function dialogMessage(message: string, opts?: { title?: string }): Promise<void> {
  return tauri().dialog.message(message, opts);
}

// ---------- FS helpers ----------
//
// These route through Rust commands (read_document / save_document /
// read_text_file) rather than Tauri's JS `fs` API. The `fs`
// allowlist has been removed from tauri.conf.json, so the webview has no direct
// filesystem capability — all reads/writes are auditable Rust commands. Paths
// still originate from user-driven open/save dialogs.

export interface DiskSnapshot {
  content: string | null;
  revision: string;
  stamp: string;
}
export type DocumentSaveResult = { status: 'saved'; revision: string; stamp: string; history_warning?: string | null }
  | { status: 'conflict'; disk: DiskSnapshot };
export interface DocumentProbe { path: string; stamp: string | null; error: string | null }

export interface LocalVersion { id: string; timestamp: number; bytes: number }
export const history = {
  list: (path: string) => invoke<LocalVersion[]>('list_document_versions', { path }),
  read: (path: string, id: string) => invoke<string>('read_document_version', { path, id }),
  checkpoint: (path: string, content: string) => invoke<void>('checkpoint_document', { path, content }),
};
export const createTemplate = (parent: string, name: string, template: string) => invoke<string>('create_template', { parent, name, template });
export const fs = {
  readDocument: (path: string) => invoke<DiskSnapshot>('read_document', { path }),
  probeDocuments: (paths: string[]) => invoke<DocumentProbe[]>('probe_documents', { paths }),
  saveDocument: (path: string, contents: string, expectedRevision: string) =>
    invoke<DocumentSaveResult>('save_document', { path, contents, expectedRevision }),
  readTextFile: (path: string) => invoke<string>('read_text_file', { path }),
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
  sourceIdentity?: string | null;
  cacheToken?: string | null;
  requestId?: string;
  fullBuild?: boolean;
  workspaceRoot?: string | null;
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
  /** The program that typeset the document (`xelatex`, or `latexmk` for a full build). */
  engine?: string;
  /** `bibtex` or `biber` when the bibliography was processed during the build. */
  bibTool?: string | null;
}

export interface BibEntry {
  key: string;
  entryType: string;
  title?: string;
  author?: string;
  editor?: string;
  year?: string;
  journal?: string;
  booktitle?: string;
  publisher?: string;
  doi?: string;
  url?: string;
  abstractText?: string;
  keywords: string[];
  volume?: string;
  number?: string;
  pages?: string;
  /** Absolute path of the .bib file this entry was parsed from. */
  sourceFile: string;
  /** 1-based line of the entry's `@type{...` within its .bib file. */
  sourceLine: number;
  sourceEndLine: number;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

/// One probed LaTeX/bibliography engine. Mirrors the Rust `settings::EngineInfo`
/// exactly: it is a plain struct (not `#[serde(rename_all)]`), so the field
/// names are already snake-free and cross the IPC boundary verbatim.
/// `path`/`version` are null when the engine is not installed, or when its
/// `--version` probe timed out and was killed.
export interface EngineInfo {
  name: string;
  path: string | null;
  version: string | null;
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

/** One parameter of a builtin Typst function. Mirrors `ParamSig` in `src/typst_sig.rs`. */
export interface TypstParamSig {
  name: string;
  /** Rendered type, e.g. `none | content`. Empty when the type is unconstrained. */
  typeName: string;
  /** First sentence of the upstream docs. */
  docs: string;
  required: boolean;
  positional: boolean;
  named: boolean;
  variadic: boolean;
  settable: boolean;
}

export interface ClavisProjectConfig {
  project: { name?: string | null; main?: string | null };
  latex: { engine?: string | null; bibliography?: string | null };
  writing?: { spelling?: 'us' | 'uk' | 'mixed' | null; ignoredAcronyms: string[]; terms: string[] };
  paths: { generated: string[]; ignored: string[] };
}

export interface WorkspaceInspection {
  root: string;
  configPath?: string | null;
  config?: ClavisProjectConfig | null;
  issues: string[];
}

export interface WorkspaceTrust {
  root: string;
  trust: 'untrusted' | 'trusted';
}

export interface ReferenceOccurrence {
  key: string;
  namespace: 'label' | 'citation' | 'unresolved' | 'ambiguous';
  role: 'definition' | 'usage';
  language: 'latex' | 'typst' | 'markdown' | 'bibtex';
  path: string;
  relativePath: string;
  line: number;
  column: number;
  start: number;
  end: number;
  fingerprint: string;
  renameable: boolean;
}

export interface ReferenceDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  key: string;
  namespace: string;
  path?: string | null;
  line?: number | null;
}

export interface ReferenceIndexResult {
  occurrences: ReferenceOccurrence[];
  diagnostics: ReferenceDiagnostic[];
  scannedFiles: number;
  truncated: boolean;
}

export interface RenameReferencePreview {
  namespace: 'label' | 'citation';
  oldKey: string;
  newKey: string;
  totalOccurrences: number;
  files: Array<{ path: string; relativePath: string; language: string; occurrences: number; firstLine: number; fingerprint: string }>;
}

export interface ApplyRenameResult {
  changedFiles: string[];
  replacements: number;
}

export interface WorkspaceSearchMatch {
  path: string;
  relativePath: string;
  line: number;
  column: number;
  preview: string;
  fingerprint: string;
}

export interface WorkspaceSearchResult {
  matches: WorkspaceSearchMatch[];
  scannedFiles: number;
  truncated: boolean;
}

export interface WorkspaceReplaceResult {
  changedFiles: string[];
  replacements: number;
}

export interface AssetUsage {
  assetPath: string;
  relativeAssetPath: string;
  sourcePath: string;
  relativeSourcePath: string;
  language: 'latex' | 'typst' | 'markdown';
  line: number;
  column: number;
  rawPath: string;
}

export interface WorkspaceAsset {
  path: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  usages: AssetUsage[];
}

export interface AssetDiagnostic {
  code: 'missing-asset' | 'unused-asset';
  severity: 'error' | 'warning';
  message: string;
  path?: string | null;
  line?: number | null;
}

export interface AssetIndexResult {
  assets: WorkspaceAsset[];
  missingUsages: AssetUsage[];
  diagnostics: AssetDiagnostic[];
  scannedFiles: number;
  truncated: boolean;
}

/** A builtin Typst function. Mirrors `FuncSig` in `src/typst_sig.rs`. */
export interface TypstFuncSig {
  /** Call name as written in a document, e.g. `figure` or `calc.pow`. */
  name: string;
  title: string;
  returns: string;
  /**
   * Reachable only inside `$...$`. ~40 names (`frac`, `vec`, `binom`, `sqrt`)
   * live in typst's math scope and nowhere else, so offering them in markup
   * would suggest code that does not compile.
   */
  mathOnly: boolean;
  params: TypstParamSig[];
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

export interface TypstDiagnostic {
  file: string | null; line: number | null; column: number | null;
  endLine: number | null; endColumn: number | null;
  severity: 'error' | 'warning'; message: string; hints: string[];
}
export interface TypstPoint { file: string | null; line: number; column: number; x: number; y: number }
export interface TypstTextRun { text: string; width: number; size: number; matrix: number[] }
export interface TypstPage { svg: string; svgHash: string; width: number; height: number; points: TypstPoint[]; text: TypstTextRun[]; links: { x: number; y: number; width: number; height: number; page: number; target_y: number }[] }
export interface TypstResult { ok: boolean; pages: TypstPage[]; diagnostics: TypstDiagnostic[]; missingPackages: string[]; dependencies: string[] }
export interface TypstSnapshot { knownSvg?: string[]; root: string | null; documents: Array<{ path: string; content: string }> }

// ---------- Typed command bindings ----------

export const ipc = {
  // --- Settings ---
  getSettings: () => invoke<AppSettings>('get_settings'),
  setSettings: (settings: AppSettings) => invoke<void>('set_settings', { settings }),
  loadSession: () => invoke<string>('load_session'),
  saveSession: (data: string) => invoke<void>('save_session', { data }),
  detectLatexEngines: () => invoke<EngineInfo[]>('detect_latex_engines'),
  detectBibEngines: () => invoke<EngineInfo[]>('detect_bib_engines'),

  // --- Workspace project configuration and trust ---
  inspectWorkspace: (root: string) =>
    invoke<WorkspaceInspection>('inspect_workspace', { root }),
  setWorkspaceTrust: (root: string, trusted: boolean) =>
    invoke<WorkspaceTrust>('set_workspace_trust', { root, trusted }),
  openWorkspaceFile: (root: string, path: string) =>
    invoke<void>('open_workspace_file', { root, path }),
  openExternalUrl: (url: string) => invoke<void>('open_external_url', { url }),
  indexAssets: (options: { root: string; documents: Array<{ path: string; language: string; text: string }> }) =>
    invoke<AssetIndexResult>('index_assets', { options }),
  listSystemFonts: () => invoke<string[]>('list_system_fonts'),
  assetPreview: (root: string, path: string) =>
    invoke<string | null>('asset_preview', { root, path }),
  /** Base64 clipboard image saved beside the document; returns its relative path. */
  saveMarkdownImage: (document: string, extension: string, data: string, target?: { folder: string; root: string }) =>
    invoke<string>('save_markdown_image', { document, extension, data, folder: target?.folder ?? null, root: target?.root ?? null }),
  /** A dropped image file referenced in place, or copied beside the document. */
  placeMarkdownImage: (document: string, source: string, target?: { folder: string; root: string }) =>
    invoke<string>('place_markdown_image', { document, source, folder: target?.folder ?? null, root: target?.root ?? null }),
  /** Documents under an open folder, for Quick Open. */
  listWorkspaceDocuments: (root: string) => invoke<string[]>('list_workspace_documents', { root }),
  searchWorkspace: (options: { root: string; query: string; regex: boolean; caseSensitive: boolean }) =>
    invoke<WorkspaceSearchResult>('search_workspace', { options }),
  replaceWorkspace: (options: { root: string; query: string; replacement: string; regex: boolean; caseSensitive: boolean; fingerprints: Record<string, string> }) =>
    invoke<WorkspaceReplaceResult>('replace_workspace', { options }),
  indexReferences: (options: { root: string; documents: Array<{ path: string; language: string; text: string; isDirty: boolean }> }) =>
    invoke<ReferenceIndexResult>('index_references', { options }),
  previewReferenceRename: (options: { root: string; documents: Array<{ path: string; language: string; text: string; isDirty: boolean }>; namespace: 'label' | 'citation'; oldKey: string; newKey: string }) =>
    invoke<RenameReferencePreview>('preview_reference_rename', { options }),
  applyReferenceRename: (options: { root: string; namespace: 'label' | 'citation'; oldKey: string; newKey: string; fingerprints: Record<string, string> }) =>
    invoke<ApplyRenameResult>('apply_reference_rename', { options }),

  // --- LaTeX ---
  cancelLatexCompile: (requestId: string) => invoke<void>('cancel_latex_compile', { requestId }),
  compileLatex: (opts: CompileOptions) => invoke<CompileResult>('compile_latex', { opts }),
  exportLatexPdf: (workdirToken: string, targetPath: string) =>
    invoke<void>('export_latex_pdf', { workdirToken, targetPath }),
  collectProjectFiles: (root: string) =>
    invoke<CollectResult>('collect_project_files', { root }),
  collectLatexSnapshot: (root: string, documents: Array<{ path: string; content: string }>) =>
    invoke<CollectResult>('collect_latex_snapshot', { root, documents }),
  detectDistro: (enginePath?: string) =>
    invoke<DistroInfo>('detect_distro', { enginePath }),
  installPackage: (manager: string, name: string) =>
    invoke<void>('install_package', { manager, name }),
  parseBib: (bibPaths: string[], documents?: Array<{ path: string; content: string }>) =>
    invoke<BibEntry[]>('parse_bib', { bibPaths, documents }),

  // --- Completion data (.cwl) ---
  // Served by package name rather than path: the names come from
  // `\usepackage{...}` in a user document, so Rust validates them against a
  // character whitelist. `null` means the package has no .cwl, which is normal.
  readCwl: (name: string) =>
    invoke<string | null>('read_cwl', { name }),
  listCwlPackages: () =>
    invoke<string[]>('list_cwl_packages'),
  cleanupWorkdir: (workdirToken: string) =>
    invoke<void>('cleanup_workdir', { workdirToken }),
  synctexForward: (workdirToken: string, line: number, column: number, inputFile = 'main.tex') =>
    invoke<SyncTexHit>('synctex_forward', { workdirToken, line, column, inputFile }),
  synctexBackward: (workdirToken: string, page: number, x: number, y: number) =>
    invoke<SyncTexEdit>('synctex_backward', { workdirToken, page, x, y }),

  // --- Typst ---
  renderFormula: (source: string) => invoke<string | null>('render_formula', { source }),
  compileTypst: (source: string, docPath?: string | null, snapshot?: TypstSnapshot) =>
    invoke<TypstResult>('compile_typst', { source, docPath, snapshot }),
  compileTypstPdf: (source: string, docPath?: string | null, snapshot?: TypstSnapshot) =>
    invoke<{ ok: boolean; pdfBase64?: string; error?: string }>('compile_typst_pdf', { source, docPath, snapshot }),
  downloadTypstPackage: (spec: string, confirmed: boolean) => invoke<void>('download_typst_package', { spec, confirmed }),
  // Builtin function signatures for the parameter tooltip. Fetched once and
  // cached client-side: the tooltip refreshes on every cursor move, and the data
  // is a compile-time constant in the typst binary, so there is nothing to
  // invalidate. ~282 KiB for 432 functions with Typst 0.15.1.
  listTypstSignatures: () =>
    invoke<TypstFuncSig[]>('list_typst_signatures'),

  // --- Filesystem ---
  scanFolderShallow: (root: string) => invoke<TreeNode>('scan_folder_shallow', { root }),
  /** The user's own stylesheet: `<config_dir>/clavis/user.css`. */
  readUserStylesheet: () => invoke<string>('read_user_stylesheet'),
  writeUserStylesheet: (css: string) => invoke<void>('write_user_stylesheet', { css }),
  userStylesheetPath: () => invoke<string>('user_stylesheet_path'),
  /** Shows the PDF in a window of its own (focuses it when already open). */
  openPdfWindow: () => invoke<void>('open_pdf_window'),
  /** Folder modification stamps (null for a missing folder), to notice added, removed or renamed entries. */
  folderStamps: (paths: string[]) => invoke<(string | null)[]>('folder_stamps', { paths }),
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
