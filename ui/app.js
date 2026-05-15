/* Clavis front-end
 * - CodeMirror 6 editor (with textarea-shaped Editor wrapper)
 * - Custom completion popup for all 3 languages
 * - Markdown via marked + KaTeX, Typst via Tauri invoke (Rust),
 *   LaTeX via real engine (pdflatex/xelatex/lualatex) -> PDF.js
 */

import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
import { Editor, BUILTIN_THEMES } from './editor.js';
import { SYMBOL_GROUPS, symbolInsertText } from './symbols.js';
pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';

const editor   = new Editor(document.getElementById('editor'));
const preview  = document.getElementById('preview');

/* Preview zoom (Markdown / Typst HTML preview). PDF has its own zoom controls.
 * Defined here so it's visible early; wiring below references modKey which is
 * declared further down (function declarations hoist; the listener body runs
 * only when an event fires, so order is fine). */
let htmlZoom = 1.0;
function setHtmlZoom(z) {
  htmlZoom = Math.max(0.5, Math.min(3.0, +z.toFixed(2)));
  preview.style.setProperty('--preview-zoom', htmlZoom);
  const info = document.getElementById('html-zoom-info');
  if (info) info.textContent = Math.round(htmlZoom * 100) + '%';
}
const pdfPages = document.getElementById('pdf-pages');
const langSel  = document.getElementById('language');
const statusEl = document.getElementById('status');
const suggest  = document.getElementById('suggest');
const btnOpen  = document.getElementById('btn-open');
const btnSave  = document.getElementById('btn-save');
const btnCompile  = document.getElementById('btn-compile');
const btnSyncFwd  = document.getElementById('btn-synctex-fwd');
const btnSettings = document.getElementById('btn-settings');
const latexCtrls  = document.getElementById('latex-controls');
const engineSel   = document.getElementById('latex-engine');
const logPanel    = document.getElementById('log-panel');
const logErrors   = document.getElementById('log-errors');
const logRaw      = document.getElementById('log-raw');
const errCount    = document.getElementById('err-count');
const logClose    = document.getElementById('log-close');
const settingsModal = document.getElementById('settings-modal');
const pdfToolbar  = document.querySelector('.pdf-toolbar');
const pdfPageInfo = document.getElementById('pdf-page-info');
const pdfZoomInfo = document.getElementById('pdf-zoom-info');
const pdfThemeSel = document.getElementById('pdf-theme');
const btnSetMain  = document.getElementById('btn-set-main');
const btnLatexExport = document.getElementById('btn-latex-export');
const typstCtrls  = document.getElementById('typst-controls');
const btnTypstPdf = document.getElementById('btn-typst-pdf');
const sidebar     = document.getElementById('sidebar');
const sbFilesSection = document.querySelector('.sb-section-files');
const sbFilesList = document.getElementById('sb-files-list');
const sbFilesCount= document.getElementById('sb-files-count');
const sbFilesRefresh = document.getElementById('sb-files-refresh');
const sbOutlineList  = document.getElementById('sb-outline-list');
const sbOutlineCount = document.getElementById('sb-outline-count');
const sbBibSection   = document.querySelector('.sb-section-bib');
const sbBibList      = document.getElementById('sb-bib-list');
const sbBibCount     = document.getElementById('sb-bib-count');
const sbBibFilter    = document.getElementById('sb-bib-filter');

let currentLang = 'markdown';
let renderTimer = null;
let rendering = false, renderQueued = false;
const docs = { markdown: null, latex: null, typst: null };
const typstRenderCache = new Map();

// Multi-file project state
const currentProject = {
  rootAbs: null,        // absolute path of main .tex
  rootBasename: null,   // e.g. "main.tex"
  activeAbs: null,      // currently open file (could be a child .tex)
  files: [],            // last collect result (CollectedFile[])
  warnings: [],
};

// Sibling files in the same directory (used for Markdown / Typst where there's no
// project concept; populated when openFile picks a .md / .typ).
let siblingFiles = [];   // { absPath, relPath, isBib }
let siblingDir   = null; // dir of the currently open file

// Dirty / file tracking — for unsaved indicator and recent files.
let isDirty = false;
function getCurrentFilePath() {
  // LaTeX project active file takes priority; otherwise sibling/active path.
  if (currentLang === 'latex' && currentProject.activeAbs) return currentProject.activeAbs;
  return _activeSiblingAbs || null;
}
function updateWindowTitle() {
  const path = getCurrentFilePath();
  const name = path ? path.split(/[\\/]/).pop() : '(untitled)';
  const dirty = isDirty ? '* ' : '';
  document.title = `${dirty}${name} — Clavis`;
}
function markDirty(v) {
  if (isDirty === v) return;
  isDirty = v;
  updateWindowTitle();
  // Reflect dirty state in the active tab too.
  const t = activeTab();
  if (t) { t.dirty = v; renderTabBar(); }
}

/* ============================================================
   Tabs — multiple documents open simultaneously.

   Strategy: keep ONE shared editor instance. On tab switch:
     - serialise current editor state into the outgoing tab
     - restore the incoming tab's state into the editor + global vars

   A tab carries everything that should be preserved across switches:
   content, cursor, scroll, language, file path, project context.
   ============================================================ */
let tabs = [];
let activeTabId = null;

function makeTab({ lang = 'markdown', path = null, content = '', dirty = false } = {}) {
  return {
    id: 'tab-' + Math.random().toString(36).slice(2, 10),
    lang, path, content,
    cursor: 0, scrollTop: 0,
    dirty,
    // LaTeX project context — null for non-LaTeX tabs.
    projectRoot: null,
    projectFiles: [],
    projectActive: null,
    // Markdown/Typst sibling context
    siblingDir: null,
    siblingFiles: [],
    activeSiblingAbs: null,
    latexWorkdirToken: null,
  };
}

function activeTab() { return tabs.find(t => t.id === activeTabId); }

function tabDisplayName(t) {
  if (t.path) return t.path.split(/[\\/]/).pop();
  return '(untitled)';
}

function tabLangIcon(lang) {
  return ({ markdown: 'MD', latex: 'TeX', typst: 'TYP' })[lang] || lang;
}

/** Snapshot the editor / globals into the given tab object. */
function stashTabState(tab) {
  if (!tab) return;
  tab.content = editor.value;
  tab.cursor  = editor.selectionStart;
  tab.scrollTop = editor.scrollDOM ? editor.scrollDOM.scrollTop : 0;
  tab.lang = currentLang;
  tab.dirty = isDirty;
  // LaTeX project
  tab.projectRoot   = currentProject.rootAbs;
  tab.projectFiles  = currentProject.files;
  tab.projectActive = currentProject.activeAbs;
  tab.latexWorkdirToken = currentWorkdir;
  // Sibling
  tab.siblingDir   = siblingDir;
  tab.siblingFiles = siblingFiles;
  tab.activeSiblingAbs = _activeSiblingAbs;
}

/** Restore the editor / globals from the given tab object. */
function restoreTabState(tab) {
  if (!tab) return;
  // Switch language (this would normally overwrite editor.value from cached
  // SAMPLES; we set the content again immediately after to make it deterministic).
  isSample = false;
  setLanguage(tab.lang || 'markdown');
  editor.value = tab.content || '';
  // Restore cursor and scroll
  if (editor.setSelectionRange) {
    editor.setSelectionRange(tab.cursor || 0, tab.cursor || 0);
  }
  if (editor.scrollDOM) editor.scrollDOM.scrollTop = tab.scrollTop || 0;
  // Restore project / sibling context
  currentProject.rootAbs = tab.projectRoot;
  currentProject.files = tab.projectFiles || [];
  currentProject.activeAbs = tab.projectActive;
  currentProject.warnings = [];
  currentWorkdir = tab.latexWorkdirToken || null;
  siblingDir = tab.siblingDir;
  siblingFiles = tab.siblingFiles || [];
  _activeSiblingAbs = tab.activeSiblingAbs;
  // Dirty flag — set directly without triggering tab-bar re-render storm.
  isDirty = !!tab.dirty;
  updateWindowTitle();
  renderSidebarFiles();
  refreshBibEntries();
  updateStatusMeta();
  applyEditorTheme();        // theme uses tab.lang sometimes
  // Highlight the active file in the workspace tree if open.
  if (typeof renderTree === 'function' && workspaceTree) renderTree();
  scheduleRender();
}

function switchToTab(id, { stash = true } = {}) {
  if (id === activeTabId) return;
  if (stash) stashTabState(activeTab());
  activeTabId = id;
  restoreTabState(activeTab());
  renderTabBar();
}

function newTab({ lang = 'markdown', path = null, content = '', dirty = false } = {}) {
  // Always stash the outgoing tab first so it survives the switch.
  stashTabState(activeTab());
  const t = makeTab({ lang, path, content, dirty });
  tabs.push(t);
  activeTabId = t.id;
  restoreTabState(t);
  renderTabBar();
  return t;
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  const t = tabs[idx];
  if (t.dirty) {
    if (!confirm(`Discard unsaved changes in "${tabDisplayName(t)}"?`)) return;
  }
  tabs.splice(idx, 1);
  if (id === activeTabId) {
    // Pick a neighbour, or create a fresh empty tab if none left.
    if (tabs.length === 0) {
      const fresh = makeTab({ lang: 'markdown' });
      tabs.push(fresh);
      activeTabId = fresh.id;
      restoreTabState(fresh);
    } else {
      const next = tabs[Math.max(0, idx - 1)];
      activeTabId = next.id;
      restoreTabState(next);
    }
  }
  renderTabBar();
}

function renderTabBar() {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.innerHTML = '';
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === activeTabId ? ' active' : '');
    el.dataset.id = t.id;
    el.title = t.path || '(untitled)';
    el.innerHTML = `
      <span class="tab-icon">${tabLangIcon(t.lang)}</span>
      <span class="tab-name">${escapeHtml(tabDisplayName(t))}</span>
      ${t.dirty ? '<span class="tab-dirty">●</span>' : ''}
      <button class="tab-close" title="Close (Ctrl+W)" data-close="${t.id}">&times;</button>
    `;
    bar.appendChild(el);
  }
  const newBtn = document.createElement('button');
  newBtn.className = 'tab-new';
  newBtn.title = 'New tab (Ctrl+T)';
  newBtn.innerHTML = '+';
  newBtn.addEventListener('click', () => newTab());
  bar.appendChild(newBtn);
}

// Event delegation for tab clicks and close buttons.
document.getElementById('tab-bar').addEventListener('click', (e) => {
  const closeBtn = e.target.closest('.tab-close');
  if (closeBtn) {
    e.stopPropagation();
    closeTab(closeBtn.dataset.close);
    return;
  }
  const tabEl = e.target.closest('.tab');
  if (tabEl) switchToTab(tabEl.dataset.id);
});
// Middle-click to close.
document.getElementById('tab-bar').addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;
  const tabEl = e.target.closest('.tab');
  if (tabEl) { e.preventDefault(); closeTab(tabEl.dataset.id); }
});

const RECENT_LIMIT = 12;
function pushRecentFile(path) {
  if (!hasTauri || !path) return;
  const list = (appSettings.recent_files || []).filter(p => p !== path);
  list.unshift(path);
  if (list.length > RECENT_LIMIT) list.length = RECENT_LIMIT;
  appSettings.recent_files = list;
  // Persist asynchronously; failure is non-critical.
  tauri.invoke('set_settings', { settings: appSettings }).catch(() => {});
  rebuildRecentMenu();
}

function rebuildRecentMenu() {
  const menu = document.getElementById('recent-menu');
  if (!menu) return;
  const list = appSettings.recent_files || [];
  if (!list.length) {
    menu.innerHTML = '<div class="recent-empty">No recent files</div>';
    return;
  }
  menu.innerHTML = list.map((p, i) => {
    const name = p.split(/[\\/]/).pop();
    const dir = p.slice(0, -(name.length + 1));
    return `<div class="recent-item" data-path="${escapeHtml(p)}">
              <span class="recent-name">${escapeHtml(name)}</span>
              <span class="recent-dir">${escapeHtml(dir)}</span>
            </div>`;
  }).join('');
}

// Tauri runtime — may be undefined if served outside the app shell.
const tauri = (typeof window !== 'undefined') ? window.__TAURI__ : undefined;
const hasTauri = !!(tauri && tauri.invoke && tauri.dialog && tauri.fs);

// On macOS, prefer ⌘ (metaKey); on Windows/Linux use Ctrl. Treat both as the
// "command" modifier for shortcut matching.
const IS_MAC = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
function modKey(e) { return IS_MAC ? e.metaKey : e.ctrlKey; }
if (IS_MAC) document.body.classList.add('is-mac');

/* Wire preview-zoom buttons & wheel now that modKey is defined. */
document.getElementById('html-zoom-in') ?.addEventListener('click', () => setHtmlZoom(htmlZoom + 0.1));
document.getElementById('html-zoom-out')?.addEventListener('click', () => setHtmlZoom(htmlZoom - 0.1));
document.getElementById('html-zoom-reset')?.addEventListener('click', () => setHtmlZoom(1.0));
preview.addEventListener('wheel', (e) => {
  // On macOS, trackpad pinch gestures arrive as wheel events with ctrlKey=true
  // (synthesised by WebKit). Treat ctrl OR command as the zoom modifier.
  const zoomMod = IS_MAC ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
  if (!zoomMod) return;
  e.preventDefault();
  setHtmlZoom(htmlZoom + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

/* ============================================================
   Settings cache (loaded at boot, refreshed when modal saves)
   ============================================================ */
let appSettings = {
  latex_engine: 'pdflatex',
  bib_engine: 'auto',
  auto_rerun: true,
  max_runs: 4,
  latex_custom_paths: {},
  pdf_dark_mode: 'off',
  editor_font_family: '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, Menlo, monospace',
  editor_font_size: 14,
  editor_line_height: 1.55,
  editor_theme: 'vscode-dark',
  editor_theme_overrides: {},
  editor_spellcheck: false,
  recent_files: [],
  pane_sidebar_width: 0,
  pane_editor_width: 0,
};

async function loadSettings() {
  if (!hasTauri) return;
  try {
    const s = await tauri.invoke('get_settings');
    if (s) appSettings = s;
    if (engineSel) engineSel.value = appSettings.latex_engine;
    if (pdfThemeSel) pdfThemeSel.value = appSettings.pdf_dark_mode;
    applyPdfTheme();
    applyEditorFont();
    applyEditorTheme();
    if (editor.setSpellcheck) editor.setSpellcheck(!!appSettings.editor_spellcheck);
  } catch (e) {
    setStatus('Load settings failed: ' + e.message, 'error');
  }
}

function applyEditorFont() {
  if (!editor || !editor.setFont) return;
  editor.setFont({
    family: appSettings.editor_font_family,
    size: appSettings.editor_font_size,
    lineHeight: appSettings.editor_line_height,
  });
}

const THEME_KEYS = ['bg', 'fg', 'gutter_bg', 'gutter_fg', 'active_bg', 'cursor', 'selection'];

function applyEditorTheme() {
  if (!editor || !editor.setTheme) return;
  // Translate snake_case keys (from settings) to camelCase keys expected by Editor.
  const ovIn = appSettings.editor_theme_overrides || {};
  const ov = snakeToCamelOverrides(ovIn);
  editor.setTheme(appSettings.editor_theme || 'vscode-dark', ov);
}

function snakeToCamelOverrides(snake) {
  const out = {};
  if (!snake) return out;
  if (snake.bg)         out.bg = snake.bg;
  if (snake.fg)         out.fg = snake.fg;
  if (snake.gutter_bg)  out.gutterBg = snake.gutter_bg;
  if (snake.gutter_fg)  out.gutterFg = snake.gutter_fg;
  if (snake.active_bg)  out.activeBg = snake.active_bg;
  if (snake.cursor)     out.cursor = snake.cursor;
  if (snake.selection)  out.selection = snake.selection;
  return out;
}

function setColorInput(id, value) {
  const el = document.getElementById(id);
  if (!el || !value) return;
  // <input type=color> only accepts #rrggbb; coerce shorthand if needed.
  let v = String(value).trim();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  }
  if (/^#[0-9a-fA-F]{6}$/.test(v)) el.value = v;
}

function fillThemeColorInputsFromCurrent() {
  const presetKey = document.getElementById('cfg-theme-preset').value
    || appSettings.editor_theme || 'vscode-dark';
  const t = BUILTIN_THEMES[presetKey] || BUILTIN_THEMES['vscode-dark'];
  const ov = appSettings.editor_theme_overrides || {};
  setColorInput('cfg-theme-bg',         ov.bg         || t.bg);
  setColorInput('cfg-theme-fg',         ov.fg         || t.fg);
  setColorInput('cfg-theme-gutter-bg',  ov.gutter_bg  || t.gutterBg);
  setColorInput('cfg-theme-gutter-fg',  ov.gutter_fg  || t.gutterFg);
  setColorInput('cfg-theme-active-bg',  ov.active_bg  || t.activeBg);
  setColorInput('cfg-theme-cursor',     ov.cursor     || t.cursor);
  setColorInput('cfg-theme-selection',  ov.selection  || t.selection);
}

/**
 * Read all color swatches and return only those that differ from the chosen preset's
 * default — those are the user's overrides to persist.
 */
function collectThemeOverrides() {
  const presetKey = document.getElementById('cfg-theme-preset').value || 'vscode-dark';
  const t = BUILTIN_THEMES[presetKey] || BUILTIN_THEMES['vscode-dark'];
  const out = {};
  const pairs = [
    ['cfg-theme-bg',         'bg',          t.bg],
    ['cfg-theme-fg',         'fg',          t.fg],
    ['cfg-theme-gutter-bg',  'gutter_bg',   t.gutterBg],
    ['cfg-theme-gutter-fg',  'gutter_fg',   t.gutterFg],
    ['cfg-theme-active-bg',  'active_bg',   t.activeBg],
    ['cfg-theme-cursor',     'cursor',      t.cursor],
    ['cfg-theme-selection',  'selection',   t.selection],
  ];
  for (const [id, key, defaultVal] of pairs) {
    const el = document.getElementById(id);
    if (!el) continue;
    const v = el.value.toLowerCase();
    const def = String(defaultVal).toLowerCase();
    if (v && v !== def) out[key] = v;
  }
  return out;
}

/**
 * Normalise a CSS font-family value entered by the user.
 *
 * - Splits on commas
 * - Strips outer whitespace
 * - Quotes any name that contains spaces or non-alphanumerics, unless already quoted
 *   or it's a CSS generic keyword (monospace, serif, sans-serif, ...).
 *
 * Returns "" if the input is empty.
 */
function normalizeFontFamily(input) {
  const raw = (input || '').trim();
  if (!raw) return '';
  const generics = new Set(['monospace', 'serif', 'sans-serif', 'cursive', 'fantasy', 'system-ui', 'ui-monospace', 'ui-serif', 'ui-sans-serif']);
  return raw.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(name => {
      // Already quoted?
      if ((name.startsWith('"') && name.endsWith('"'))
        || (name.startsWith("'") && name.endsWith("'"))) return name;
      // Generic CSS keyword — leave bare.
      if (generics.has(name.toLowerCase())) return name;
      // Single word with only ASCII letters/digits/dash — bare is fine.
      if (/^[A-Za-z0-9-]+$/.test(name)) return name;
      // Anything else (spaces, dots, CJK) — quote it.
      return `"${name.replace(/"/g, '\\"')}"`;
    })
    .join(', ');
}

/* ============================================================
   Status / errors
   ============================================================ */
function setStatus(msg, cls = '') { statusEl.textContent = msg; statusEl.className = 'status ' + cls; }
window.addEventListener('error', (e) => setStatus('JS error: ' + (e.message || 'unknown'), 'error'));
window.addEventListener('unhandledrejection', (e) =>
  setStatus('Promise error: ' + ((e.reason && e.reason.message) || e.reason), 'error'));

const statusMeta = document.getElementById('status-meta');
function updateStatusMeta() {
  if (!statusMeta) return;
  const v = editor.value;
  const pos = editor.selectionStart;
  // Compute line:col
  let line = 1, col = 0, lastNL = -1;
  for (let i = 0; i < pos; i++) {
    if (v.charCodeAt(i) === 10) { line++; lastNL = i; }
  }
  col = pos - lastNL; // 1-based column
  // Word/char count (cheap; fine up to ~MB scale).
  const chars = v.length;
  // Words: split by whitespace, ignore empty
  const words = v ? (v.match(/\S+/g) || []).length : 0;
  statusMeta.textContent = `Ln ${line}, Col ${col}  ·  ${words} words  ·  ${chars} chars`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
// Escape a captured group destined for HTML attribute context (href/src).
function escapeAttr(s) {
  return String(s).replace(/[&<>"'`]/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;' }[c]));
}
// Only allow http(s)/mailto/relative URLs in user-supplied links.
function safeUrl(u) {
  const s = String(u).trim();
  if (/^(https?:|mailto:|#|\/|\.{0,2}\/)/i.test(s)) return escapeAttr(s);
  return '#';
}

/* ============================================================
   Renderers
   ============================================================ */
function renderKaTeX(tex, displayMode) {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'html', strict: 'ignore' });
  } catch (e) {
    return `<span class="err">${escapeHtml(e.message)}</span>`;
  }
}

function markdownWithMath(src) {
  const ph = [];
  const stash = h => { const k = `\u0000M${ph.length}\u0000`; ph.push(h); return k; };
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, b) => stash(renderKaTeX(b, true)));
  src = src.replace(/(?<!\\)\$([^\n$]+?)(?<!\\)\$/g, (_, b) => stash(renderKaTeX(b, false)));
  let html = marked.parse(src);
  return html.replace(/\u0000M(\d+)\u0000/g, (_, i) => ph[+i]);
}

function renderLatexDoc(src) {
  const docMatch = src.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  let body = docMatch ? docMatch[1] : src;
  const title  = (src.match(/\\title\{([^}]*)\}/)  || [])[1];
  const author = (src.match(/\\author\{([^}]*)\}/) || [])[1];
  const date   = (src.match(/\\date\{([^}]*)\}/)   || [])[1];

  const math = [];
  const stash = h => { const k = `\u0000M${math.length}\u0000`; math.push(h); return k; };
  body = body.replace(/\$\$([\s\S]+?)\$\$/g, (_, b) => stash(renderKaTeX(b, true)));
  body = body.replace(/\\\[([\s\S]+?)\\\]/g, (_, b) => stash(renderKaTeX(b, true)));
  body = body.replace(/\\begin\{equation\*?\}([\s\S]+?)\\end\{equation\*?\}/g, (_, b) => stash(renderKaTeX(b, true)));
  body = body.replace(/\\begin\{align\*?\}([\s\S]+?)\\end\{align\*?\}/g, (_, b) => stash(renderKaTeX('\\begin{aligned}'+b+'\\end{aligned}', true)));
  body = body.replace(/\\\(([\s\S]+?)\\\)/g, (_, b) => stash(renderKaTeX(b, false)));
  body = body.replace(/(?<!\\)\$([^\n$]+?)(?<!\\)\$/g, (_, b) => stash(renderKaTeX(b, false)));

  body = body.replace(/(^|[^\\])%[^\n]*/g, '$1');

  // Stash verbatim/raw blocks so they bypass the HTML-injection replacements.
  const raw = [];
  const stashRaw = h => { const k = `\u0000R${raw.length}\u0000`; raw.push(h); return k; };

  body = body
    .replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_, c) => {
      const items = c.split(/\\item\s*/).slice(1).map(it => `<li>${escapeHtml(it.trim())}</li>`).join('');
      return stashRaw('<ul>' + items + '</ul>');
    })
    .replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g, (_, c) => {
      const items = c.split(/\\item\s*/).slice(1).map(it => `<li>${escapeHtml(it.trim())}</li>`).join('');
      return stashRaw('<ol>' + items + '</ol>');
    })
    .replace(/\\begin\{quote\}([\s\S]*?)\\end\{quote\}/g, (_, c) =>
      stashRaw('<blockquote>' + escapeHtml(c.trim()) + '</blockquote>'))
    .replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, (_, c) =>
      stashRaw('<div class="tex-center">' + escapeHtml(c.trim()) + '</div>'))
    .replace(/\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/g, (_, c) =>
      stashRaw('<pre><code>' + escapeHtml(c) + '</code></pre>'));

  body = body
    .replace(/\\section\*?\{([^}]*)\}/g,       (_, t) => stashRaw('<h1>' + escapeHtml(t) + '</h1>'))
    .replace(/\\subsection\*?\{([^}]*)\}/g,    (_, t) => stashRaw('<h2>' + escapeHtml(t) + '</h2>'))
    .replace(/\\subsubsection\*?\{([^}]*)\}/g, (_, t) => stashRaw('<h3>' + escapeHtml(t) + '</h3>'))
    .replace(/\\paragraph\{([^}]*)\}/g,        (_, t) => stashRaw('<h4>' + escapeHtml(t) + '</h4>'));

  body = body
    .replace(/\\textbf\{([^}]*)\}/g,    (_, t) => stashRaw('<strong>' + escapeHtml(t) + '</strong>'))
    .replace(/\\textit\{([^}]*)\}/g,    (_, t) => stashRaw('<em>' + escapeHtml(t) + '</em>'))
    .replace(/\\emph\{([^}]*)\}/g,      (_, t) => stashRaw('<em>' + escapeHtml(t) + '</em>'))
    .replace(/\\texttt\{([^}]*)\}/g,    (_, t) => stashRaw('<code>' + escapeHtml(t) + '</code>'))
    .replace(/\\underline\{([^}]*)\}/g, (_, t) => stashRaw('<u>' + escapeHtml(t) + '</u>'))
    .replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, (_, u, t) =>
      stashRaw('<a href="' + safeUrl(u) + '" rel="noopener noreferrer">' + escapeHtml(t) + '</a>'))
    .replace(/\\url\{([^}]*)\}/g, (_, u) =>
      stashRaw('<a href="' + safeUrl(u) + '" rel="noopener noreferrer">' + escapeHtml(u) + '</a>'))
    .replace(/\\maketitle/g, '');

  // Now escape any remaining raw text, then restore stashed HTML.
  body = escapeHtml(body);

  body = body
    .replace(/\\\\/g, '<br/>')
    .replace(/\\&/g, '&amp;').replace(/\\%/g, '%').replace(/\\#/g, '#').replace(/\\_/g, '_')
    .replace(/~/g, '&nbsp;').replace(/---/g, '&mdash;').replace(/--/g, '&ndash;');

  const paragraphs = body.split(/\n\s*\n/).map(p => {
    const t = p.trim();
    if (!t) return '';
    if (/^\u0000R\d+\u0000$/.test(t)) return t;
    return `<p>${t.replace(/\n/g, ' ')}</p>`;
  }).join('\n');

  let html = paragraphs
    .replace(/\u0000R(\d+)\u0000/g, (_, i) => raw[+i])
    .replace(/\u0000M(\d+)\u0000/g, (_, i) => math[+i]);

  let header = '';
  if (title)  header += `<h1 class="tex-title">${escapeHtml(title)}</h1>`;
  if (author) header += `<div class="tex-author">${escapeHtml(author)}</div>`;
  if (date)   header += `<div class="tex-date">${escapeHtml(date)}</div>`;

  return `<div class="latex-doc-wrap">${header}${html}</div>
    <div class="latex-doc-footer">
      LaTeX preview: math via KaTeX, document commands rendered to HTML.
      For full PDF compilation, save as .tex and run pdflatex.
    </div>`;
}

async function renderTypst(src) {
  if (!tauri || !tauri.invoke) {
    throw new Error('Typst requires the Tauri runtime (not available in browser preview).');
  }
  const cached = typstRenderCache.get(src);
  if (cached) return cached;
  const result = await tauri.invoke('compile_typst', { source: src });
  if (!result.ok) {
    throw new Error(result.error || 'Typst compilation failed');
  }
  // result.svg comes from a trusted Rust backend (typst-svg); inserted as-is.
  const html = `<div class="typst-svg">${result.svg}</div>`;
  typstRenderCache.set(src, html);
  if (typstRenderCache.size > 8) {
    const firstKey = typstRenderCache.keys().next().value;
    if (firstKey !== undefined) typstRenderCache.delete(firstKey);
  }
  return html;
}

async function exportTypstPdf() {
  if (!hasTauri) { setStatus('Export unavailable (no Tauri runtime)', 'error'); return; }
  if (currentLang !== 'typst') return;
  setStatus('Compiling Typst → PDF…');
  if (btnTypstPdf) btnTypstPdf.disabled = true;
  try {
    const r = await tauri.invoke('compile_typst_pdf', { source: editor.value });
    if (!r.ok || !r.pdfBase64) {
      setStatus('Typst PDF: ' + (r.error || 'unknown error'), 'error');
      return;
    }
    const path = await tauri.dialog.save({
      defaultPath: 'document.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!path) { setStatus('Cancelled'); return; }
    const bytes = b64ToBytes(r.pdfBase64);
    await tauri.fs.writeBinaryFile(path, bytes);
    setStatus(`Saved: ${path}`, 'ok');
  } catch (e) {
    setStatus('Export failed: ' + (e.message || e), 'error');
  } finally {
    if (btnTypstPdf) btnTypstPdf.disabled = false;
  }
}

if (btnTypstPdf) btnTypstPdf.addEventListener('click', exportTypstPdf);

async function exportLatexPdf() {
  if (!hasTauri) { setStatus('Export unavailable (no Tauri runtime)', 'error'); return; }
  if (currentLang !== 'latex') return;
  if (!currentWorkdir) {
    setStatus('Compile first (Ctrl+B) before exporting.', 'error');
    return;
  }
  try {
    // Suggest a sensible default name based on the project root / open file.
    const srcPath = currentProject.rootAbs || currentProject.activeAbs || '';
    const srcName = srcPath ? srcPath.split(/[\\/]/).pop().replace(/\.tex$/i, '') : 'document';
    const target = await tauri.dialog.save({
      defaultPath: `${srcName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!target) { setStatus('Cancelled'); return; }
    await tauri.invoke('export_latex_pdf', { workdirToken: currentWorkdir, targetPath: target });
    setStatus(`Saved: ${target}`, 'ok');
  } catch (e) {
    setStatus('Export failed: ' + (e.message || e), 'error');
  }
}

if (btnLatexExport) btnLatexExport.addEventListener('click', exportLatexPdf);

/* ============================================================
   Render dispatcher
   ============================================================ */
async function render() {
  if (rendering) { renderQueued = true; return; }
  rendering = true;
  const langAtStart = currentLang;
  const src = editor.value;
  // LaTeX is compiled on demand (Ctrl+B); don't auto-render here.
  if (langAtStart === 'latex') {
    rendering = false;
    return;
  }
  // Skip if nothing changed since last successful render. Saves a noticeable
  // chunk of time on Typst when the user just clicks back to an already-
  // rendered tab (Rust compile pass is ~100-500ms even for small docs).
  if (langAtStart === lastRenderedLang
      && src === lastRenderedSrc
      && preview.innerHTML && !preview.innerHTML.includes('placeholder')) {
    rendering = false;
    return;
  }
  setStatus('Rendering…');
  try {
    let html;
    if (langAtStart === 'markdown')   html = markdownWithMath(src);
    else if (langAtStart === 'typst') html = await renderTypst(src);
    if (langAtStart === currentLang && html !== undefined) {
      preview.innerHTML = html;
      lastRenderedLang = langAtStart;
      lastRenderedSrc = src;
      setStatus('Rendered', 'ok');
    }
  } catch (e) {
    preview.innerHTML = `<div class="err">${escapeHtml(e.stack || e.message || String(e))}</div>`;
    setStatus('Error', 'error');
  } finally {
    rendering = false;
    if (renderQueued) { renderQueued = false; scheduleRender(); }
  }
}
let lastRenderedLang = null;
let lastRenderedSrc = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  // Typst spawns a Rust compile that scales with doc size; give it more headroom.
  const delay = currentLang === 'typst' ? 500 : 250;
  renderTimer = setTimeout(render, delay);
}

/* ============================================================
   Custom autocomplete popup
   ============================================================ */
let sgItems = [];     // current visible completion items
let sgIndex = 0;
let sgRange = null;   // { from, to } in editor

function activeList() {
  if (currentLang === 'latex')    return LATEX_COMPLETIONS;
  if (currentLang === 'typst')    return TYPST_COMPLETIONS;
  return MD_SNIPPETS;
}

function tokenAtCursor() {
  const v = editor.value;
  const pos = editor.selectionStart;
  // language-specific token patterns
  let re;
  if (currentLang === 'latex') {
    re = /\\[A-Za-z*]*\{?[A-Za-z*]*\}?$/;
  } else if (currentLang === 'typst') {
    re = /#?[A-Za-z][\w.]*$/;
  } else {
    re = /[A-Za-z][\w-]*$/;
  }
  const before = v.slice(0, pos);
  const m = before.match(re);
  if (!m) return null;
  return { token: m[0], from: pos - m[0].length, to: pos };
}

/**
 * If the cursor is inside a \cite{... | ...} (or \citep, \citet, \autocite, etc.)
 * return { keyToken, from, to } where from/to span the current key being typed.
 * Otherwise return null.
 */
function citeKeyAtCursor() {
  if (currentLang !== 'latex') return null;
  const v = editor.value;
  const pos = editor.selectionStart;
  const before = v.slice(0, pos);
  const lastOpen = before.lastIndexOf('{');
  if (lastOpen < 0) return null;
  // Anything closing in between?
  if (before.lastIndexOf('}') > lastOpen) return null;
  // The command preceding lastOpen must be a cite-family.
  const slice = before.slice(Math.max(0, lastOpen - 32), lastOpen);
  const cmdMatch = /\\([A-Za-z]+)\s*$/.exec(slice);
  if (!cmdMatch) return null;
  const cmd = cmdMatch[1].toLowerCase();
  if (!/^(?:cite|citep|citet|citeauthor|citeyear|autocite|parencite|textcite|footcite|nocite|fullcite|smartcite)\b/.test(cmd)) {
    return null;
  }
  // Identify the current key substring (between last ',' or '{' and pos).
  const afterOpen = before.slice(lastOpen + 1);
  const commaIdx = Math.max(afterOpen.lastIndexOf(','), afterOpen.lastIndexOf(' '));
  const keyStart = lastOpen + 1 + (commaIdx >= 0 ? commaIdx + 1 : 0);
  const keyToken = v.slice(keyStart, pos);
  return { keyToken: keyToken.trim(), from: keyStart, to: pos };
}

function showSuggest(items, range) {
  if (!items.length) { hideSuggest(); return; }
  sgItems = items;
  sgIndex = 0;
  sgRange = range;
  suggest.innerHTML = items.map((it, i) =>
    `<div class="sg-item${i===0?' active':''}" data-i="${i}">
       <span class="sg-label">${escapeHtml(it.l)}</span>
       <span class="sg-desc">${escapeHtml(it.d || '')}</span>
     </div>`
  ).join('');
  positionSuggest();
  suggest.classList.remove('hidden');
}
function hideSuggest() {
  suggest.classList.add('hidden');
  sgItems = []; sgRange = null;
}

function positionSuggest() {
  const c = editor.caretCoords();
  if (!c) return;
  const top  = c.bottom + 2;
  const left = c.left;
  suggest.style.top  = Math.min(top,  window.innerHeight - 280) + 'px';
  suggest.style.left = Math.min(left, window.innerWidth  - 280) + 'px';
}

function triggerCompletion(explicit = false) {
  // Citation picker takes priority inside \cite{...}
  const cite = citeKeyAtCursor();
  if (cite) {
    showCiteSuggest(cite);
    return;
  }
  const tok = tokenAtCursor();
  if (!tok && !explicit) { hideSuggest(); return; }
  const all = activeList();
  let items;
  if (tok && tok.token) {
    const q = tok.token.toLowerCase();
    items = all.filter(c => c.l.toLowerCase().includes(q));
    items.sort((a, b) => {
      const aStarts = a.l.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.l.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.l.length - b.l.length;
    });
  } else {
    items = all.slice();
  }
  items = items.slice(0, 80);
  const range = tok || { from: editor.selectionStart, to: editor.selectionStart };
  if (!items.length) { hideSuggest(); return; }
  showSuggest(items, range);
}

function showCiteSuggest(cite) {
  if (!bibEntries.length) { hideSuggest(); return; }
  const q = cite.keyToken.toLowerCase();
  const ranked = bibEntries
    .map(b => {
      const inKey = b.key.toLowerCase().includes(q);
      const inTitle = (b.title || '').toLowerCase().includes(q);
      const inAuthor = (b.author || '').toLowerCase().includes(q);
      const keyStarts = b.key.toLowerCase().startsWith(q);
      if (q && !inKey && !inTitle && !inAuthor) return null;
      return { b, score: (keyStarts ? 0 : inKey ? 1 : inAuthor ? 2 : 3) };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .slice(0, 60)
    .map(({ b }) => ({
      // Reuse the suggest popup's contract: l = label, d = description, t = template.
      l: b.key,
      d: [b.author, b.year, b.title].filter(Boolean).join(' · '),
      t: b.key,
    }));
  if (!ranked.length) { hideSuggest(); return; }
  showSuggest(ranked, { from: cite.from, to: cite.to });
}

function applyCompletion(item) {
  if (!sgRange) return;
  const v = editor.value;
  // Expand snippet: find $1 placeholder, place caret there with selected default text
  let template = item.t;
  let caretFrom = -1, caretTo = -1;
  const m = template.match(/\$1([^\n$]*)/);
  let insertText;
  if (m) {
    const before = template.slice(0, m.index);
    const def = m[1] || '';
    const after = template.slice(m.index + m[0].length).replace(/\$\d+/g, '');
    insertText = before + def + after;
    caretFrom = sgRange.from + before.length;
    caretTo   = caretFrom + def.length;
  } else {
    insertText = template.replace(/\$\d+/g, '');
    caretFrom = caretTo = sgRange.from + insertText.length;
  }
  editor.value = v.slice(0, sgRange.from) + insertText + v.slice(sgRange.to);
  editor.selectionStart = caretFrom;
  editor.selectionEnd   = caretTo;
  hideSuggest();
  scheduleRender();
}

suggest.addEventListener('mousedown', (e) => {
  const target = e.target.closest('.sg-item');
  if (!target) return;
  e.preventDefault();
  const i = parseInt(target.dataset.i, 10);
  if (!Number.isNaN(i) && sgItems[i]) applyCompletion(sgItems[i]);
});

function highlightActiveSuggest() {
  for (const el of suggest.querySelectorAll('.sg-item')) {
    el.classList.toggle('active', parseInt(el.dataset.i, 10) === sgIndex);
  }
  const active = suggest.querySelector('.sg-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

editor.dom.addEventListener('keydown', (e) => {
  // Ctrl/Cmd+Space — open completion (CodeMirror's autocompletion is configured with override:[],
  // so the default Ctrl-Space is a no-op; we handle it ourselves.)
  if (modKey(e) && (e.code === 'Space' || e.key === ' ')) {
    e.preventDefault();
    triggerCompletion(true);
    return;
  }
  if (suggest.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    sgIndex = (sgIndex + 1) % sgItems.length;
    highlightActiveSuggest();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    sgIndex = (sgIndex - 1 + sgItems.length) % sgItems.length;
    highlightActiveSuggest();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    e.stopPropagation();
    applyCompletion(sgItems[sgIndex]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideSuggest();
  }
}, true);

editor.onChange(() => {
  scheduleRender();
  scheduleOutline();
  scheduleAutoCompile();
  updateStatusMeta();
  // Auto-pop on relevant trigger chars
  const cite = citeKeyAtCursor();
  const tok = tokenAtCursor();
  if (cite) {
    triggerCompletion(false);
  } else if (tok && tok.token.length >= 1) {
    triggerCompletion(false);
  } else {
    hideSuggest();
  }
  // Mark sample as dirty
  isSample = false;
  markDirty(true);
});
editor.onCursorMove(() => updateStatusMeta());
/* ----- Surround: Ctrl/Cmd+B → bold, Ctrl/Cmd+I → italic, etc.
   Keys depend on language. */
const SURROUND_BINDINGS = {
  markdown: {
    'b': ['**', '**'],
    'i': ['*', '*'],
    'k': ['`', '`'],            // inline code
  },
  latex: {
    'i': ['\\emph{', '}'],
    // Cmd/Ctrl+B clashes with "Compile" in LaTeX, so we don't bind 'b' here.
    'k': ['\\texttt{', '}'],
  },
  typst: {
    'b': ['*', '*'],
    'i': ['_', '_'],
    'k': ['`', '`'],
  },
};

editor.dom.addEventListener('keydown', (e) => {
  if (!modKey(e) || e.altKey) return;
  // Don't interfere with: Ctrl+B for LaTeX compile, Ctrl+S, Ctrl+O...
  if (currentLang === 'latex' && (e.key === 'b' || e.key === 'B')) return;
  const bindings = SURROUND_BINDINGS[currentLang];
  if (!bindings) return;
  const key = (e.key || '').toLowerCase();
  const pair = bindings[key];
  if (!pair) return;
  e.preventDefault();
  editor.surroundSelection(pair[0], pair[1]);
}, true);

editor.dom.addEventListener('blur',  () => setTimeout(hideSuggest, 100));
editor.scrollDOM.addEventListener('scroll', () => hideSuggest());

/* ============================================================
   Samples + language switching
   ============================================================ */
const SAMPLES = {
  markdown: `# Welcome to Clavis

This is a **Markdown** document with live preview.

## Features
- GitHub-flavored Markdown
- Inline math \$E = mc^2\$ and display math:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

> Tip: press **Ctrl+Space** for autocomplete.
`,
  latex: `\\documentclass{article}
\\title{A Sample LaTeX Document}
\\author{Clavis}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
This is a \\textbf{LaTeX} preview. Math via KaTeX:
\\[
  \\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
\\]

\\begin{itemize}
  \\item First item
  \\item Second with \\emph{emphasis}
\\end{itemize}

\\end{document}
`,
  typst: `#set page(paper: "a4", margin: 2cm)
#set heading(numbering: "1.1")

= Welcome to Typst

This is a *Typst* document, compiled by the real Typst compiler in Rust.

== Math
The Pythagorean identity:
$ sin^2(theta) + cos^2(theta) = 1 $

== List
- First item
- Second item
- Third with _emphasis_
`,
};

let isSample = true;
let isSwitching = false;

function setLanguage(lang) {
  if (isSwitching || !['markdown','latex','typst'].includes(lang)) return;
  isSwitching = true;
  try {
    if (currentLang !== lang) {
      docs[currentLang] = editor.value;
    }
    const sameLangAsBefore = (currentLang === lang);
    currentLang = lang;
    langSel.value = lang;
    hideSuggest();
    // Only reconfigure the language extension when actually changing — saves
    // a full CodeMirror reconfiguration when this is called redundantly.
    if (!sameLangAsBefore) {
      editor.setLanguage(lang);
    }

    // Decide the new doc content, but only assign if it actually differs from
    // what's already in the editor — assigning editor.value triggers a full
    // CM replaceAll (expensive on large docs).
    let nextContent;
    const saved = docs[lang];
    if (saved !== null && saved !== undefined) {
      nextContent = saved;
    } else if (isSample) {
      nextContent = SAMPLES[lang];
    } else {
      nextContent = '';
    }
    if (nextContent !== editor.value) {
      editor.value = nextContent;
    }

    // Toggle LaTeX-only UI
    const latexMode = (lang === 'latex');
    const typstMode = (lang === 'typst');
    if (latexCtrls) latexCtrls.hidden = !latexMode;
    if (typstCtrls) typstCtrls.hidden = !typstMode;
    if (sbBibSection)   sbBibSection.hidden   = !latexMode;
    if (pdfToolbar) pdfToolbar.hidden = !latexMode || !currentPdfDoc;
    if (latexMode) {
      renderSidebarFiles();
      refreshBibEntries();
      // Show PDF view if we have one; else placeholder text
      if (currentPdfDoc) {
        preview.classList.add('hidden');
        pdfPages.classList.remove('hidden');
      } else {
        pdfPages.classList.add('hidden');
        preview.classList.remove('hidden');
        preview.innerHTML = `<div class="placeholder">
          Press <kbd>Ctrl</kbd>+<kbd>B</kbd> or click <b>Compile</b> to render with
          <code>${escapeHtml(appSettings.latex_engine || 'pdflatex')}</code>.
        </div>`;
      }
      setStatus(currentPdfDoc ? 'Ready (last PDF cached)' : 'Ready');
    } else {
      pdfPages.classList.add('hidden');
      preview.classList.remove('hidden');
      if (pdfFinder) pdfFinder.classList.add('hidden');
      renderSidebarFiles();
      scheduleRender();
    }
    renderOutline_or_schedule();
  } catch (e) {
    setStatus('Switch error: ' + e.message, 'error');
  } finally {
    isSwitching = false;
  }
}

// Helper: prefer the debounced path so a setLanguage call doesn't pay outline
// computation cost synchronously.
function renderOutline_or_schedule() { scheduleOutline(); }

function initWindowDragging() {
  const toolbar = document.querySelector('.toolbar');
  const dragApi = tauri && tauri.window && tauri.window.appWindow && tauri.window.appWindow.startDragging;
  if (!toolbar || typeof dragApi !== 'function') return;
  toolbar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, select, input, textarea, label')) return;
    dragApi().catch(() => {});
  });
}

langSel.addEventListener('change', e => setLanguage(e.target.value));

/* ============================================================
   File menu (Tauri dialogs)
   ============================================================ */
async function openFile(forcedPath = null) {
  if (!hasTauri) { setStatus('File I/O unavailable (no Tauri runtime)', 'error'); return; }
  try {
    let path = forcedPath;
    if (!path) {
      path = await tauri.dialog.open({
        multiple: false,
        filters: [
          { name: 'Documents', extensions: ['md', 'markdown', 'tex', 'latex', 'sty', 'cls', 'typ', 'txt'] },
          { name: 'All', extensions: ['*'] },
        ],
      });
      if (!path) return;
    }
    // If the path is already open in some tab, just switch to it (no duplicate).
    const existing = tabs.find(t => t.path === path);
    if (existing) {
      switchToTab(existing.id);
      setStatus(`Switched: ${path}`, 'ok');
      return;
    }
    const content = await tauri.fs.readTextFile(path);
    const ext = (path.split('.').pop() || '').toLowerCase();
    let lang = 'markdown';
    if (ext === 'md' || ext === 'markdown') lang = 'markdown';
    else if (ext === 'tex' || ext === 'latex' || ext === 'sty' || ext === 'cls') lang = 'latex';
    else if (ext === 'typ') lang = 'typst';

    // Decide whether to reuse the current tab or open a new one.
    //   - Current tab is the initial untitled+empty+clean tab → reuse
    //   - Otherwise → new tab
    const cur = activeTab();
    const reuseCurrent = cur && !cur.path && !cur.dirty && !(cur.content && cur.content.trim());
    if (reuseCurrent) {
      cur.lang = lang;
      cur.path = path;
      cur.content = content;
      cur.cursor = 0; cur.scrollTop = 0; cur.dirty = false;
      restoreTabState(cur);
      renderTabBar();
    } else {
      newTab({ lang, path, content });
    }

    // Per-language post-load hooks (project root inference / sibling scan).
    if (lang === 'latex') {
      await inferProjectRoot(path, content);
      // Re-stash so the project context lives on the tab.
      stashTabState(activeTab());
    } else if (lang === 'markdown' || lang === 'typst') {
      _activeSiblingAbs = path;
      await loadSiblingsFor(path, lang);
      stashTabState(activeTab());
      renderSidebarFiles();
    }
    pushRecentFile(path);
    updateWindowTitle();
    renderTabBar();
    scheduleRender();
    setStatus(`Opened: ${path}`, 'ok');
  } catch (e) {
    setStatus('Open failed: ' + e.message, 'error');
  }
}

/**
 * Decide whether the just-opened file is itself the project root, or whether
 * we should treat it as a child of an unknown root. Strategy:
 *  - If file contains \documentclass → it IS the root
 *  - Otherwise leave currentProject.rootAbs unset; user can hit "Set main".
 */
async function inferProjectRoot(absPath, content) {
  currentProject.activeAbs = absPath;
  if (/\\documentclass\b/.test(content)) {
    await setProjectRoot(absPath);
  } else if (!currentProject.rootAbs) {
    setStatus('Sub-file mode (no root). Click "Set main" if this is the main file.', 'ok');
  }
}

async function setProjectRoot(absPath) {
  if (!hasTauri) return;
  try {
    const r = await tauri.invoke('collect_project_files', { root: absPath });
    currentProject.rootAbs = absPath;
    currentProject.rootBasename = r.rootRel;
    currentProject.activeAbs = absPath;
    currentProject.files = r.files || [];
    currentProject.warnings = r.warnings || [];
    setStatus(`Project root: ${absPath} (${currentProject.files.length} files)`, 'ok');
    renderSidebarFiles();
    refreshBibEntries();
  } catch (e) {
    setStatus('Project scan failed: ' + (e.message || e), 'error');
  }
}

if (btnSetMain) btnSetMain.addEventListener('click', async () => {
  if (!currentProject.activeAbs) {
    setStatus('Open a .tex file first', 'error'); return;
  }
  await setProjectRoot(currentProject.activeAbs);
});

/* ============================================================
   Sidebar — Files list
   ============================================================ */
function basename(p) {
  if (!p) return '';
  return p.split(/[\\/]/).pop();
}

function fileIcon(f) {
  if (f.isBib) return '\u{1F4DA}';                   // 📚
  if (/\.(tex|ltx|sty|cls)$/i.test(f.relPath)) return '\u{1F4C4}'; // 📄
  if (/\.(png|jpg|jpeg|gif|pdf)$/i.test(f.relPath)) return '\u{1F5BC}'; // 🖼
  return '\u{1F4C3}';                                // 📃
}

function renderSidebarFiles() {
  if (!sbFilesList) return;

  // LaTeX with a project root → list project files. Otherwise list siblings.
  const usingProject = currentLang === 'latex' && currentProject.rootAbs;
  const list = usingProject ? (currentProject.files || []) : siblingFiles;
  sbFilesCount.textContent = String(list.length);
  sbFilesList.innerHTML = '';

  if (!list.length) {
    sbFilesList.innerHTML = usingProject
      ? '<li class="sb-empty">(empty)</li>'
      : '';
    return;
  }

  // For project: sort root first then by relPath. For siblings: alpha.
  const sorted = list.slice().sort((a, b) => {
    if (usingProject) {
      if (a.absPath === currentProject.rootAbs) return -1;
      if (b.absPath === currentProject.rootAbs) return 1;
    }
    return a.relPath.localeCompare(b.relPath);
  });

  const activeAbs = usingProject ? currentProject.activeAbs : siblingDir
    ? joinPath(siblingDir, currentSiblingName())
    : null;

  for (const f of sorted) {
    const isRoot = usingProject && f.absPath === currentProject.rootAbs;
    const isActive = f.absPath === activeAbs;
    const li = document.createElement('li');
    li.className = 'sb-item' + (isRoot ? ' is-root' : '') + (isActive ? ' active' : '');
    li.dataset.abs = f.absPath;
    li.title = f.absPath;
    li.innerHTML = `
      <span class="sb-icon">${fileIcon(f)}</span>
      <span class="sb-name">${escapeHtml(f.relPath)}</span>
      ${isRoot ? '<span class="sb-badge">root</span>' : ''}
    `;
    li.addEventListener('click', () => openProjectFile(f.absPath));
    sbFilesList.appendChild(li);
  }
}

function joinPath(dir, name) {
  if (!dir) return name;
  return dir.endsWith('/') || dir.endsWith('\\') ? dir + name : dir + '/' + name;
}
let _activeSiblingAbs = null;
function currentSiblingName() {
  return _activeSiblingAbs ? _activeSiblingAbs.split(/[\\/]/).pop() : '';
}

const SIBLING_EXT_BY_LANG = {
  markdown: ['md', 'markdown', 'mdown', 'mkd'],
  typst:    ['typ'],
  latex:    ['tex', 'ltx', 'sty', 'cls', 'bib'],
};

async function loadSiblingsFor(absPath, lang) {
  if (!hasTauri) { siblingFiles = []; return; }
  // Derive directory.
  const sep = absPath.includes('\\') ? '\\' : '/';
  const dir = absPath.slice(0, absPath.lastIndexOf(sep));
  siblingDir = dir;
  _activeSiblingAbs = absPath;
  const exts = SIBLING_EXT_BY_LANG[lang] || [];
  try {
    const entries = await tauri.fs.readDir(dir, { recursive: false });
    siblingFiles = entries
      .filter(e => !e.children) // files only, not subdirs
      .filter(e => {
        const ext = (e.name.split('.').pop() || '').toLowerCase();
        return exts.includes(ext);
      })
      .map(e => ({
        absPath: e.path,
        relPath: e.name,
        isBib: e.name.toLowerCase().endsWith('.bib'),
      }));
  } catch (e) {
    siblingFiles = [];
    setStatus('Read dir failed: ' + (e.message || e), 'error');
  }
}

async function openProjectFile(absPath) {
  if (!hasTauri) return;
  const sameAsLatexActive = currentProject.activeAbs === absPath;
  const sameAsSibling = _activeSiblingAbs === absPath;
  if (sameAsLatexActive || sameAsSibling) return;
  // Save current edits back into the project file cache before switching.
  stashActiveEdits();
  try {
    const content = await tauri.fs.readTextFile(absPath);
    editor.value = content;
    if (currentLang === 'latex' && currentProject.rootAbs) {
      currentProject.activeAbs = absPath;
      const isRoot = absPath === currentProject.rootAbs;
      setStatus(isRoot
        ? `Switched to root: ${basename(absPath)}`
        : `Switched to ${basename(absPath)} (compile still uses main)`, 'ok');
    } else {
      _activeSiblingAbs = absPath;
      setStatus(`Opened: ${basename(absPath)}`, 'ok');
    }
    renderSidebarFiles();
  } catch (e) {
    setStatus('Open failed: ' + (e.message || e), 'error');
  }
}

if (sbFilesRefresh) {
  sbFilesRefresh.addEventListener('click', async () => {
    if (currentLang === 'latex' && currentProject.rootAbs) {
      await setProjectRoot(currentProject.rootAbs);
    } else if (_activeSiblingAbs) {
      await loadSiblingsFor(_activeSiblingAbs, currentLang);
    }
    renderSidebarFiles();
  });
}

/* ============================================================
   Sidebar — Outline (Markdown / LaTeX / Typst)
   ============================================================ */
const LATEX_LEVELS = {
  part: 0, chapter: 1, section: 2, subsection: 3,
  subsubsection: 4, paragraph: 5, subparagraph: 6,
};

function parseOutline(src, lang) {
  const items = [];
  if (lang === 'markdown') {
    // ATX headings; ignore #s inside fenced code blocks.
    const lines = src.split('\n');
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*```/.test(l) || /^\s*~~~/.test(l)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
      if (m) items.push({ level: m[1].length - 1, title: m[2].trim(), line: i + 1 });
    }
  } else if (lang === 'latex') {
    // \section{...} family. Skip lines starting with % (comments).
    const lines = src.split('\n');
    const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]*)\}/g;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*%/.test(l)) continue;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(l))) {
        items.push({ level: LATEX_LEVELS[m[1]] ?? 2, title: m[2].trim(), line: i + 1 });
      }
    }
  } else if (lang === 'typst') {
    // Lines starting with one or more '=' followed by space.
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^(=+)\s+(.+?)\s*$/.exec(lines[i]);
      if (m) items.push({ level: m[1].length - 1, title: m[2].trim(), line: i + 1 });
    }
  }
  return items;
}

let outlineTimer = null;
function scheduleOutline() {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(renderOutline, 250);
}

function renderOutline() {
  if (!sbOutlineList) return;
  const items = parseOutline(editor.value, currentLang);
  sbOutlineCount.textContent = String(items.length);
  sbOutlineList.innerHTML = '';
  if (!items.length) {
    sbOutlineList.innerHTML = '<li class="sb-empty">(no headings)</li>';
    return;
  }
  // Normalize so the smallest seen level becomes 0 — gives nice indent for sub-files.
  const minLevel = Math.min(...items.map(it => it.level));
  for (const it of items) {
    const indent = Math.max(0, it.level - minLevel);
    const li = document.createElement('li');
    li.className = 'sb-item sb-outline-item';
    li.style.paddingLeft = (12 + indent * 12) + 'px';
    li.dataset.line = String(it.line);
    li.title = `Line ${it.line}: ${it.title}`;
    li.innerHTML = `<span class="sb-name">${escapeHtml(it.title)}</span>
                    <span class="sb-line">L${it.line}</span>`;
    li.addEventListener('click', () => jumpEditorToLine(it.line));
    sbOutlineList.appendChild(li);
  }
}

/* ============================================================
   Sidebar — Bibliography entries
   ============================================================ */
let bibEntries = [];
let bibLastSig = '';

async function refreshBibEntries() {
  if (!hasTauri || !sbBibList) return;
  // Collect .bib paths from the current project.
  const paths = (currentProject.files || [])
    .filter(f => f.isBib)
    .map(f => f.absPath);
  const sig = paths.join('|');
  if (sig === bibLastSig && bibEntries.length) {
    renderBibList(); return;
  }
  bibLastSig = sig;
  if (!paths.length) {
    bibEntries = [];
    renderBibList();
    return;
  }
  try {
    bibEntries = await tauri.invoke('parse_bib', { bibPaths: paths });
  } catch (e) {
    bibEntries = [];
    setStatus('Bib parse failed: ' + (e.message || e), 'error');
  }
  renderBibList();
}

function renderBibList() {
  if (!sbBibList) return;
  sbBibCount.textContent = String(bibEntries.length);
  sbBibList.innerHTML = '';
  if (!bibEntries.length) {
    sbBibList.innerHTML = '<li class="sb-empty">(no .bib entries)</li>';
    return;
  }
  const q = (sbBibFilter && sbBibFilter.value || '').trim().toLowerCase();
  const items = q
    ? bibEntries.filter(b =>
        b.key.toLowerCase().includes(q)
        || (b.title || '').toLowerCase().includes(q)
        || (b.author || '').toLowerCase().includes(q))
    : bibEntries;
  for (const b of items.slice(0, 200)) {
    const li = document.createElement('li');
    li.className = 'sb-item sb-bib-item';
    li.title = `${b.key}\n${b.title || ''}\n${b.author || ''} ${b.year || ''}\n${b.sourceFile}:${b.sourceLine}`;
    li.innerHTML = `
      <span class="sb-bib-key">${escapeHtml(b.key)}</span>
      <span class="sb-bib-meta">${escapeHtml(b.title || b.entryType)}</span>
    `;
    li.addEventListener('dblclick', () => insertCiteAtCursor(b.key));
    sbBibList.appendChild(li);
  }
  if (items.length > 200) {
    const li = document.createElement('li');
    li.className = 'sb-empty';
    li.textContent = `… ${items.length - 200} more (refine filter)`;
    sbBibList.appendChild(li);
  }
}

function insertCiteAtCursor(key) {
  const v = editor.value;
  const pos = editor.selectionStart;
  // If cursor already sits inside an existing \cite{...}, append "key" to the list.
  const before = v.slice(0, pos);
  const after = v.slice(pos);
  const openIdx = before.lastIndexOf('\\cite');
  const lastBrace = before.lastIndexOf('{');
  const lastCloseBrace = before.lastIndexOf('}');
  const inCite = openIdx >= 0
    && lastBrace > openIdx
    && (lastCloseBrace < lastBrace);
  let insert;
  if (inCite) {
    // Append ", key" before the closing brace
    const closeIdx = after.indexOf('}');
    if (closeIdx >= 0) {
      const prefix = before;
      const middle = after.slice(0, closeIdx);
      const trail = after.slice(closeIdx);
      const sep = middle.trim().length ? ', ' : '';
      editor.value = prefix + middle + sep + key + trail;
      const newPos = prefix.length + middle.length + sep.length + key.length;
      editor.setSelectionRange(newPos, newPos);
      editor.focus();
      return;
    }
  }
  insert = `\\cite{${key}}`;
  editor.value = before + insert + after;
  const newPos = before.length + insert.length;
  editor.setSelectionRange(newPos, newPos);
  editor.focus();
}

if (sbBibFilter) sbBibFilter.addEventListener('input', renderBibList);

async function saveFile(opts = {}) {
  const { saveAs = false } = opts;
  if (!hasTauri) { setStatus('File I/O unavailable (no Tauri runtime)', 'error'); return; }
  try {
    let path = saveAs ? null : getCurrentFilePath();
    if (!path) {
      const ext = currentLang === 'markdown' ? 'md' : currentLang === 'latex' ? 'tex' : 'typ';
      path = await tauri.dialog.save({
        defaultPath: `document.${ext}`,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'LaTeX',    extensions: ['tex'] },
          { name: 'Typst',    extensions: ['typ'] },
        ],
      });
      if (!path) return;
      // Update the in-memory tracking so future Ctrl+S goes here.
      if (currentLang === 'latex') {
        currentProject.activeAbs = path;
      } else {
        _activeSiblingAbs = path;
      }
    }
    await tauri.fs.writeTextFile(path, editor.value);
    // Update active tab so future Ctrl+S stays here and tab title shows correctly.
    const cur = activeTab();
    if (cur) { cur.path = path; cur.dirty = false; }
    markDirty(false);
    pushRecentFile(path);
    updateWindowTitle();
    renderTabBar();
    setStatus(`Saved: ${path}`, 'ok');
  } catch (e) {
    setStatus('Save failed: ' + e.message, 'error');
  }
}

if (!hasTauri) {
  btnOpen.disabled = true;
  btnSave.disabled = true;
  btnOpen.title = btnSave.title = 'Tauri runtime not available';
}
btnOpen.addEventListener('click', openFile);
btnSave.addEventListener('click', saveFile);
window.addEventListener('keydown', (e) => {
  // ⌘/Ctrl+T  — new tab
  // ⌘/Ctrl+W  — close current tab
  // ⌘/Ctrl+Tab — next tab; ⌘/Ctrl+Shift+Tab — previous tab
  // ⌘/Ctrl+1..9 — jump to tab N
  if (modKey(e) && (e.key === 't' || e.key === 'T') && !e.shiftKey) {
    e.preventDefault(); newTab(); return;
  }
  if (modKey(e) && (e.key === 'w' || e.key === 'W') && !e.shiftKey) {
    e.preventDefault();
    if (activeTabId) closeTab(activeTabId);
    return;
  }
  if (modKey(e) && e.key === 'Tab') {
    e.preventDefault();
    const i = tabs.findIndex(t => t.id === activeTabId);
    const dir = e.shiftKey ? -1 : 1;
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    if (next) switchToTab(next.id);
    return;
  }
  if (modKey(e) && /^[1-9]$/.test(e.key)) {
    const idx = parseInt(e.key, 10) - 1;
    if (idx < tabs.length) {
      e.preventDefault();
      switchToTab(tabs[idx].id);
      return;
    }
  }

  if (e.ctrlKey && e.shiftKey && (e.key === 'o' || e.key === 'O') && !IS_MAC) {
    e.preventDefault(); openFolder();
  } else if (e.ctrlKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault(); saveFile({ saveAs: true });
  } else if (e.ctrlKey && e.key === 'o') { e.preventDefault(); openFile(); }
  else if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFile(); }
  // macOS users typically press ⌘O / ⌘S / ⌘⇧S
  else if (IS_MAC && e.metaKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault(); saveFile({ saveAs: true });
  }
  else if (IS_MAC && e.metaKey && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault(); openFolder();
  }
  else if (IS_MAC && e.metaKey && e.key === 'o') { e.preventDefault(); openFile(); }
  else if (IS_MAC && e.metaKey && e.key === 's') { e.preventDefault(); saveFile(); }
});

/* ============================================================
   LaTeX compile + PDF.js viewer + SyncTeX
   ============================================================ */
let currentWorkdir = null;
let currentPdfDoc = null;
let currentPdfBytes = null;
let currentPage = 1;
let currentZoom = 1.5;

// Auto-compile (live) state for LaTeX
let autoCompileEnabled = true;
let autoCompileTimer = null;
let autoCompileBusy = false;
const AUTO_COMPILE_DELAY_MS = 1500;

function scheduleAutoCompile() {
  if (!autoCompileEnabled) return;
  if (currentLang !== 'latex') return;
  if (!hasTauri) return;
  clearTimeout(autoCompileTimer);
  autoCompileTimer = setTimeout(() => {
    if (autoCompileBusy) {
      // Re-arm so the latest version still gets compiled.
      scheduleAutoCompile();
      return;
    }
    autoCompileBusy = true;
    compileLatex({ silent: true })
      .finally(() => { autoCompileBusy = false; });
  }, AUTO_COMPILE_DELAY_MS);
}

const cbAutoCompile = document.getElementById('cb-auto-compile');
if (cbAutoCompile) {
  cbAutoCompile.addEventListener('change', () => {
    autoCompileEnabled = cbAutoCompile.checked;
  });
}

function showLogPanel() { logPanel.classList.remove('hidden'); }
function hideLogPanel() { logPanel.classList.add('hidden'); }

function clearLog() {
  logRaw.textContent = '';
  logErrors.innerHTML = '';
  errCount.textContent = '0';
}
function appendLogLine(p) {
  const cls = p.stream === 'stderr' ? 'log-stderr'
            : p.stream === 'info'   ? 'log-info'
            : 'log-stdout';
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = `[${p.run}] ${p.text}\n`;
  logRaw.appendChild(span);
  // Auto-scroll
  logRaw.scrollTop = logRaw.scrollHeight;
}
function appendRunHeader(p) {
  const span = document.createElement('span');
  span.className = 'log-runhead';
  span.textContent = `\n--- run ${p.run}: ${p.command} ---\n`;
  logRaw.appendChild(span);
  logRaw.scrollTop = logRaw.scrollHeight;
}
function showErrors(errors) {
  errCount.textContent = String(errors.length);
  logErrors.innerHTML = '';
  if (!errors.length) {
    logErrors.innerHTML = '<div class="muted">No errors.</div>';
    return;
  }
  for (const err of errors) {
    const row = document.createElement('div');
    row.className = 'log-row log-' + (err.kind || 'error');
    const lineLink = (typeof err.line === 'number' && err.line > 0)
      ? `<a class="log-jump" data-line="${err.line}">L${err.line}</a>`
      : '<span class="muted">--</span>';
    let installBtn = '';
    if (err.kind === 'missing-file' && err.package) {
      installBtn = ` <button class="log-install" data-pkg="${escapeHtml(err.package)}">Install ${escapeHtml(err.package)}</button>`;
    }
    row.innerHTML = `${lineLink} <span class="log-kind">${err.kind}</span> ${escapeHtml(err.message)}${installBtn}`;
    logErrors.appendChild(row);
  }
}

logErrors.addEventListener('click', (e) => {
  const a = e.target.closest('.log-jump');
  if (a) {
    const line = parseInt(a.dataset.line, 10);
    if (Number.isFinite(line)) jumpEditorToLine(line);
    return;
  }
  const ib = e.target.closest('.log-install');
  if (ib) {
    e.preventDefault();
    const pkg = ib.dataset.pkg;
    installMissingPackage(pkg, ib);
    return;
  }
});

let cachedDistro = null;
async function ensureDistro() {
  if (cachedDistro) return cachedDistro;
  if (!hasTauri) return null;
  const engine = engineSel ? engineSel.value : 'pdflatex';
  const customPath = (appSettings.latex_custom_paths || {})[engine];
  try {
    cachedDistro = await tauri.invoke('detect_distro', { enginePath: customPath });
  } catch (_) {
    cachedDistro = null;
  }
  return cachedDistro;
}

async function installMissingPackage(pkg, btnEl) {
  if (!hasTauri) return;
  const distro = await ensureDistro();
  if (!distro || distro.manager === 'none') {
    setStatus(`No package manager found (distro: ${distro ? distro.name : 'unknown'})`, 'error');
    return;
  }
  const ok = confirm(`Install package "${pkg}" via ${distro.manager}?\n\nThis may take a while.`);
  if (!ok) return;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Installing…'; }
  setStatus(`Installing ${pkg}…`);
  showLogPanel();
  try {
    await tauri.invoke('install_package', { manager: distro.manager, name: pkg });
    setStatus(`Installed ${pkg}; recompiling…`, 'ok');
    await compileLatex();
  } catch (e) {
    setStatus(`Install ${pkg} failed: ${e.message || e}`, 'error');
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = `Install ${pkg}`; }
  }
}

function jumpEditorToLine(line) {
  editor.focus();
  editor.scrollLineIntoView(line);
}

if (logClose) logClose.addEventListener('click', hideLogPanel);
document.querySelectorAll('.log-tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.log-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.log-pane').forEach(p =>
      p.classList.toggle('active', p.id === 'log-' + tab.dataset.tab));
    // Lazy-load the full .log content when the "Full .log" tab is selected.
    if (tab.dataset.tab === 'full') {
      const out = document.getElementById('log-full');
      out.textContent = 'loading…';
      try {
        if (!currentWorkdir) {
          out.textContent = '(no workdir — compile first)';
          return;
        }
        const text = await tauri.invoke('read_latex_log', { workdirToken: currentWorkdir });
        out.textContent = text || '(empty .log)';
        // Scroll to end to show the most recent compile.
        out.scrollTop = out.scrollHeight;
      } catch (e) {
        out.textContent = 'Could not read .log: ' + (e.message || e);
      }
    }
  });
});

/* Log font size, persisted per-session in window memory (cheap; no settings churn). */
let logFontPx = 12;
function setLogFontPx(px) {
  logFontPx = Math.max(8, Math.min(24, px));
  for (const el of document.querySelectorAll('.log-body, .log-pane')) {
    el.style.fontSize = logFontPx + 'px';
  }
}
setLogFontPx(12);
const logFontInc = document.getElementById('log-font-inc');
const logFontDec = document.getElementById('log-font-dec');
if (logFontInc) logFontInc.addEventListener('click', () => setLogFontPx(logFontPx + 1));
if (logFontDec) logFontDec.addEventListener('click', () => setLogFontPx(logFontPx - 1));

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function compileLatex(opts = {}) {
  const silent = !!opts.silent;
  if (!hasTauri) { setStatus('Compile unavailable (no Tauri runtime)', 'error'); return; }
  if (currentLang !== 'latex') return;

  const tab = activeTab();
  if (!tab) return;
  stashTabState(tab);

  const engine = engineSel.value || appSettings.latex_engine;
  const customPath = appSettings.latex_custom_paths
    ? appSettings.latex_custom_paths[engine]
    : undefined;

  if (!silent) { showLogPanel(); clearLog(); }
  setStatus(silent ? 'Auto-compiling…' : 'Compiling…');
  btnCompile.disabled = true;

  // Multi-file project: use the latest scan, but override the active file with editor content
  // so unsaved edits participate in the build. If no project root, single-file mode.
  let projectFiles = [];
  let mainSource = tab.content;
  let projectRoot = tab.projectRoot;
  let projectActive = tab.projectActive;
  let workdirToken = tab.latexWorkdirToken;
  if (projectRoot) {
    try {
      // Re-scan to pick up file additions on disk; cheap because filesystem cache.
      const r = await tauri.invoke('collect_project_files', { root: projectRoot });
      currentProject.files = r.files || [];
      currentProject.warnings = r.warnings || [];
      renderSidebarFiles();
      refreshBibEntries();
    } catch (_) { /* keep last known */ }

    for (const f of currentProject.files) {
      if (f.absPath === projectRoot) {
        // The root: its content goes via `source`, not project_files
        mainSource = (projectActive === projectRoot) ? tab.content : f.content;
        continue;
      }
      let content = f.content;
      if (projectActive && projectActive === f.absPath) {
        // Active sub-file with possibly unsaved edits
        content = tab.content;
      }
      projectFiles.push({
        relPath: f.relPath,
        content,
        binaryBase64: f.binaryBase64 || null,
      });
    }
  }

  const unlistenLog = await tauri.event.listen('latex-log', e => appendLogLine(e.payload));
  const unlistenStart = await tauri.event.listen('latex-run-start', e => appendRunHeader(e.payload));

  try {
    const r = await tauri.invoke('compile_latex', {
      opts: {
        source: mainSource,
        engine,
        customPath,
        bibEngine: appSettings.bib_engine,
        autoRerun: appSettings.auto_rerun,
        maxRuns: appSettings.max_runs,
        synctex: true,
        workdirToken,
        projectFiles,
      }
    });
    if (workdirToken && r.workdirToken && workdirToken !== r.workdirToken) {
      tauri.invoke('cleanup_workdir', { workdirToken }).catch(()=>{});
    }
    tab.latexWorkdirToken = r.workdirToken || null;
    if (activeTabId === tab.id) {
      currentWorkdir = r.workdirToken || null;
    }
    showErrors(r.errors || []);
    if (r.ok && r.pdfBase64 && activeTabId === tab.id) {
      const bytes = b64ToBytes(r.pdfBase64);
      currentPdfBytes = bytes;
      await loadPdf(bytes);
      setStatus(`Rendered (${r.runs} run${r.runs===1?'':'s'})`, 'ok');
    } else if (activeTabId === tab.id) {
      const n = (r.errors || []).length;
      setStatus(`Compile failed (${n} error${n===1?'':'s'})`, 'error');
    }
    if (r.logTail && activeTabId === tab.id) {
      const span = document.createElement('span');
      span.className = 'log-info';
      span.textContent = '\n--- summary log tail ---\n' + r.logTail + '\n';
      logRaw.appendChild(span);
      logRaw.scrollTop = logRaw.scrollHeight;
    }
  } catch (e) {
    setStatus('Compile error: ' + (e.message || e), 'error');
  } finally {
    unlistenLog(); unlistenStart();
    btnCompile.disabled = false;
  }
}

async function loadPdf(bytes) {
  if (currentPdfDoc) {
    try { await currentPdfDoc.destroy(); } catch (_) {}
    currentPdfDoc = null;
  }
  // pdf.js consumes the buffer; pass a copy so we can re-render later
  const copy = bytes.slice(0);
  currentPdfDoc = await pdfjs.getDocument({ data: copy }).promise;
  currentPage = 1;
  preview.classList.add('hidden');
  pdfPages.classList.remove('hidden');
  pdfToolbar.hidden = false;
  await renderAllPages();
}

async function renderAllPages() {
  if (!currentPdfDoc) return;
  pdfPages.innerHTML = '';
  applyPdfTheme();
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  for (let i = 1; i <= currentPdfDoc.numPages; i++) {
    const page = await currentPdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: currentZoom });
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page';
    wrap.dataset.page = String(i);
    wrap.style.width = viewport.width + 'px';
    wrap.style.height = viewport.height + 'px';

    // Canvas: backing store at dpr*viewport for crisp rendering on Retina/HiDPI;
    // CSS dims stay at viewport size so layout is unchanged.
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    wrap.appendChild(canvas);

    // Text layer — enables text selection/copy and powers the find UI.
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'pdf-text-layer';
    textLayerDiv.style.width = viewport.width + 'px';
    textLayerDiv.style.height = viewport.height + 'px';
    wrap.appendChild(textLayerDiv);

    wrap.addEventListener('dblclick', (e) => onPdfDblClick(e, i, viewport));
    pdfPages.appendChild(wrap);

    const ctx = canvas.getContext('2d');
    // Render PDF into the larger backing store using a scaled viewport, so each
    // PDF point maps to dpr CSS-px → CSS-px×dpr device-px.
    const renderViewport = dpr === 1 ? viewport : page.getViewport({ scale: currentZoom * dpr });
    await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

    // Render text layer (pdf.js v4 TextLayer class)
    try {
      const textContent = await page.getTextContent();
      const tl = new pdfjs.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await tl.render();
    } catch (e) {
      console.warn('text layer render failed for page', i, e);
    }
  }
  updatePageInfo();
  updateZoomInfo();
  // If a search query is active, re-apply highlights on the new layers.
  if (pdfFindQuery) applyPdfFindHighlights();
}

function updatePageInfo() {
  if (!currentPdfDoc) { pdfPageInfo.textContent = '- / -'; return; }
  pdfPageInfo.textContent = `${currentPage} / ${currentPdfDoc.numPages}`;
}
function updateZoomInfo() {
  pdfZoomInfo.textContent = Math.round(currentZoom * 100 / 1.5) + '%';
}
function scrollToPage(n) {
  const wrap = pdfPages.querySelector(`.pdf-page[data-page="${n}"]`);
  if (wrap) {
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    currentPage = n;
    updatePageInfo();
  }
}
pdfPages.addEventListener('wheel', (e) => {
  const zoomMod = IS_MAC ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
  if (!zoomMod) return;
  e.preventDefault();
  if (e.deltaY < 0) { currentZoom = Math.min(4, currentZoom + 0.1); }
  else              { currentZoom = Math.max(0.5, currentZoom - 0.1); }
  renderAllPages();
}, { passive: false });

pdfPages.addEventListener('scroll', () => {
  // Find the topmost visible page
  if (!currentPdfDoc) return;
  const top = pdfPages.scrollTop;
  let best = 1, bestDist = Infinity;
  for (const w of pdfPages.querySelectorAll('.pdf-page')) {
    const d = Math.abs(w.offsetTop - top);
    if (d < bestDist) { bestDist = d; best = parseInt(w.dataset.page, 10); }
  }
  if (best !== currentPage) { currentPage = best; updatePageInfo(); }
});

document.getElementById('pdf-prev').addEventListener('click',
  () => { if (currentPdfDoc && currentPage > 1) scrollToPage(currentPage - 1); });
document.getElementById('pdf-next').addEventListener('click',
  () => { if (currentPdfDoc && currentPage < currentPdfDoc.numPages) scrollToPage(currentPage + 1); });
document.getElementById('pdf-zoom-in').addEventListener('click',
  () => { currentZoom = Math.min(4, currentZoom + 0.25); renderAllPages(); });
document.getElementById('pdf-zoom-out').addEventListener('click',
  () => { currentZoom = Math.max(0.5, currentZoom - 0.25); renderAllPages(); });
pdfThemeSel.addEventListener('change', () => {
  appSettings.pdf_dark_mode = pdfThemeSel.value;
  applyPdfTheme();
  // Persist asynchronously
  if (hasTauri) tauri.invoke('set_settings', { settings: appSettings }).catch(()=>{});
});

function applyPdfTheme() {
  pdfPages.classList.remove('theme-invert', 'theme-sepia');
  const m = appSettings.pdf_dark_mode;
  if (m === 'invert') pdfPages.classList.add('theme-invert');
  else if (m === 'sepia') pdfPages.classList.add('theme-sepia');
}

/* ----- PDF Find UI (Ctrl+F over the text layer) ----- */
const pdfFinder      = document.getElementById('pdf-finder');
const pdfFinderInput = document.getElementById('pdf-finder-input');
const pdfFinderInfo  = document.getElementById('pdf-finder-info');
const pdfFinderPrev  = document.getElementById('pdf-finder-prev');
const pdfFinderNext  = document.getElementById('pdf-finder-next');
const pdfFinderCase  = document.getElementById('pdf-finder-case');
const pdfFinderClose = document.getElementById('pdf-finder-close');

let pdfFindQuery   = '';
let pdfFindCase    = false;
let pdfFindMatches = [];   // { el, page }
let pdfFindIndex   = -1;

function openPdfFinder() {
  if (!currentPdfDoc) {
    setStatus('Compile a document first', 'error');
    return;
  }
  pdfFinder.classList.remove('hidden');
  pdfFinderInput.focus();
  pdfFinderInput.select();
}
function closePdfFinder() {
  pdfFinder.classList.add('hidden');
  clearPdfFindHighlights();
  pdfFindQuery = '';
  updatePdfFindInfo();
}

function clearPdfFindHighlights() {
  for (const m of pdfFindMatches) {
    if (m.el && m.el.parentNode) {
      const parent = m.el.parentNode;
      parent.replaceChild(document.createTextNode(m.el.textContent), m.el);
      parent.normalize();
    }
  }
  pdfFindMatches = [];
  pdfFindIndex = -1;
}

function applyPdfFindHighlights() {
  clearPdfFindHighlights();
  const q = pdfFindQuery;
  if (!q) { updatePdfFindInfo(); return; }
  const flags = pdfFindCase ? 'g' : 'gi';
  let needle;
  try {
    needle = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch { return; }

  const layers = pdfPages.querySelectorAll('.pdf-text-layer');
  layers.forEach((layer, idx) => {
    const page = idx + 1;
    // pdf.js text layer creates many <span> per text item.
    const spans = layer.querySelectorAll('span');
    for (const span of spans) {
      // Skip spans that already contain children (we don't recurse).
      if (span.children.length > 0) continue;
      const text = span.textContent;
      if (!text) continue;
      needle.lastIndex = 0;
      if (!needle.test(text)) continue;
      // Replace text with marked spans
      needle.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      while ((m = needle.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const mark = document.createElement('span');
        mark.className = 'pdf-match';
        mark.textContent = m[0];
        frag.appendChild(mark);
        pdfFindMatches.push({ el: mark, page });
        last = m.index + m[0].length;
        if (m[0].length === 0) needle.lastIndex++;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      span.textContent = '';
      span.appendChild(frag);
    }
  });
  if (pdfFindMatches.length) {
    pdfFindIndex = 0;
    focusCurrentMatch();
  }
  updatePdfFindInfo();
}

function focusCurrentMatch() {
  for (const m of pdfFindMatches) m.el.classList.remove('active');
  if (pdfFindIndex < 0 || pdfFindIndex >= pdfFindMatches.length) return;
  const m = pdfFindMatches[pdfFindIndex];
  m.el.classList.add('active');
  m.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function updatePdfFindInfo() {
  if (!pdfFindMatches.length) {
    pdfFinderInfo.textContent = pdfFindQuery ? '0/0' : '';
  } else {
    pdfFinderInfo.textContent = `${pdfFindIndex + 1}/${pdfFindMatches.length}`;
  }
}

if (pdfFinderInput) {
  pdfFinderInput.addEventListener('input', () => {
    pdfFindQuery = pdfFinderInput.value;
    applyPdfFindHighlights();
  });
  pdfFinderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePdfFinder(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!pdfFindMatches.length) return;
      pdfFindIndex = e.shiftKey
        ? (pdfFindIndex - 1 + pdfFindMatches.length) % pdfFindMatches.length
        : (pdfFindIndex + 1) % pdfFindMatches.length;
      focusCurrentMatch();
      updatePdfFindInfo();
    }
  });
}
if (pdfFinderPrev) pdfFinderPrev.addEventListener('click', () => {
  if (!pdfFindMatches.length) return;
  pdfFindIndex = (pdfFindIndex - 1 + pdfFindMatches.length) % pdfFindMatches.length;
  focusCurrentMatch(); updatePdfFindInfo();
});
if (pdfFinderNext) pdfFinderNext.addEventListener('click', () => {
  if (!pdfFindMatches.length) return;
  pdfFindIndex = (pdfFindIndex + 1) % pdfFindMatches.length;
  focusCurrentMatch(); updatePdfFindInfo();
});
if (pdfFinderCase) pdfFinderCase.addEventListener('change', () => {
  pdfFindCase = pdfFinderCase.checked;
  applyPdfFindHighlights();
});
if (pdfFinderClose) pdfFinderClose.addEventListener('click', closePdfFinder);

/* ----- SyncTeX ----- */
function caretLineCol() {
  const v = editor.value;
  const pos = editor.selectionStart;
  let line = 1, col = 0, lastNL = -1;
  for (let i = 0; i < pos; i++) {
    if (v.charCodeAt(i) === 10) { line++; lastNL = i; }
  }
  col = pos - lastNL - 1;
  return { line, column: col };
}

async function synctexForward() {
  if (!hasTauri || !currentWorkdir || !currentPdfDoc) {
    setStatus('SyncTeX needs a compiled document', 'error'); return;
  }
  try {
    const { line, column } = caretLineCol();
    const hit = await tauri.invoke('synctex_forward', {
      workdirToken: currentWorkdir, line, column,
    });
    scrollToPage(hit.page);
    flashHighlight(hit);
  } catch (e) {
    setStatus('SyncTeX: ' + (e.message || e), 'error');
  }
}

function flashHighlight(hit) {
  const wrap = pdfPages.querySelector(`.pdf-page[data-page="${hit.page}"]`);
  if (!wrap) return;
  // SyncTeX coords are in TeX bp (≈ pt). The viewport scale already accounts for
  // dpi; PDF.js page width in bp ≈ canvas.width / currentZoom * 72/72 (close enough).
  // We map proportionally using the PDF page's MediaBox via the page's natural size.
  const canvas = wrap.querySelector('canvas');
  if (!canvas) return;
  const flashScale = currentZoom; // 1pt → currentZoom px (approx)
  const el = document.createElement('div');
  el.className = 'pdf-flash';
  const x = Math.max(0, (hit.h || hit.x) * flashScale - 4);
  const y = Math.max(0, (hit.v || hit.y) * flashScale - 16);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.width = Math.max(40, (hit.w || 80) * flashScale) + 'px';
  el.style.height = Math.max(16, (hit.height || 14) * flashScale) + 'px';
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

async function onPdfDblClick(ev, pageNum, viewport) {
  if (!hasTauri || !currentWorkdir) return;
  const wrap = ev.currentTarget;
  const rect = wrap.getBoundingClientRect();
  const px = ev.clientX - rect.left;
  const py = ev.clientY - rect.top;
  // px/py are in canvas px (= pt * currentZoom); convert back to pt
  const x = px / currentZoom;
  const y = py / currentZoom;
  try {
    const r = await tauri.invoke('synctex_backward', {
      workdirToken: currentWorkdir, page: pageNum, x, y,
    });
    if (typeof r.line !== 'number') return;
    // r.inputFile is what SyncTeX recorded — usually a workdir-relative path like "main.tex"
    // or "chapters/intro.tex". Map back to an absolute project path.
    const targetAbs = mapInputFileToAbs(r.inputFile);
    if (targetAbs && currentProject.activeAbs && targetAbs !== currentProject.activeAbs) {
      const ok = confirm(`Jump to ${targetAbs}?\n\nThis will switch the editor to that file.`);
      if (!ok) {
        setStatus(`SyncTeX target: ${r.inputFile}:${r.line} (cancelled)`);
        return;
      }
      // Save current edits back into the project file cache
      stashActiveEdits();
      try {
        const content = await tauri.fs.readTextFile(targetAbs);
        editor.value = content;
        currentProject.activeAbs = targetAbs;
        renderSidebarFiles();
        const isRoot = (targetAbs === currentProject.rootAbs);
        setStatus(isRoot
          ? `Switched to root: ${targetAbs}`
          : `Switched to sub-file: ${targetAbs} (compile still uses main)`, 'ok');
      } catch (e) {
        setStatus('Open sub-file failed: ' + (e.message || e), 'error');
        return;
      }
    }
    jumpEditorToLine(r.line);
    setStatus(`Jumped to line ${r.line}` + (targetAbs ? ` in ${targetAbs.split(/[\\/]/).pop()}` : ''), 'ok');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/no SyncTeX backward hit/i.test(msg)) {
      // Common case: user double-clicked on margin/whitespace where the PDF has no
      // source mapping. Soft-fail with a friendlier hint instead of red error.
      setStatus('SyncTeX: no source location at that spot — try double-clicking on text');
    } else {
      setStatus('SyncTeX reverse: ' + msg, 'error');
    }
  }
}

function mapInputFileToAbs(inputFile) {
  if (!inputFile || !currentProject.rootAbs) return null;
  // If SyncTeX returns absolute already (some engines do), accept as-is.
  if (/^([a-zA-Z]:[\\/]|\/)/.test(inputFile)) return inputFile;
  // Else look up in collected files by relPath match (case-insensitive on Windows).
  const norm = inputFile.replace(/^\.\//, '').replace(/\\/g, '/');
  const found = currentProject.files.find(f =>
    f.relPath.replace(/\\/g, '/').toLowerCase() === norm.toLowerCase()
    || f.relPath.replace(/\\/g, '/').toLowerCase().endsWith('/' + norm.toLowerCase()));
  return found ? found.absPath : null;
}

function stashActiveEdits() {
  if (!currentProject.activeAbs) return;
  const f = currentProject.files.find(x => x.absPath === currentProject.activeAbs);
  if (f) f.content = editor.value;
}

if (btnCompile)  btnCompile.addEventListener('click', compileLatex);
if (btnSyncFwd)  btnSyncFwd.addEventListener('click', synctexForward);
window.addEventListener('keydown', (e) => {
  if (modKey(e) && (e.key === 'b' || e.key === 'B') && currentLang === 'latex') {
    e.preventDefault(); compileLatex();
  } else if (modKey(e) && e.altKey && (e.key === 'j' || e.key === 'J')) {
    e.preventDefault(); synctexForward();
  } else if (modKey(e) && (e.key === 'f' || e.key === 'F')) {
    // Route Ctrl/Cmd+F based on what's currently focused.
    // - Editor (CodeMirror) focused → let CM's built-in search panel handle it.
    // - PDF panel visible & editor not focused → our PDF finder.
    // - Otherwise → CM search.
    const editorFocused = editor.dom.contains(document.activeElement);
    const pdfVisible = currentLang === 'latex' && currentPdfDoc
      && !pdfPages.classList.contains('hidden');
    if (!editorFocused && pdfVisible) {
      e.preventDefault();
      openPdfFinder();
    }
    // else: let CM's keymap (already wired in editor.js) handle it.
  } else if (modKey(e) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    openCommandPalette();
  } else if (modKey(e) && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault();
    if (currentLang === 'typst') exportTypstPdf();
    else if (currentLang === 'latex') exportLatexPdf();
  } else if (modKey(e) && (e.key === '=' || e.key === '+')) {
    // Ctrl/Cmd + "=" → zoom in preview (PDF or HTML, whichever is showing)
    e.preventDefault();
    if (currentLang === 'latex' && currentPdfDoc) {
      currentZoom = Math.min(4, currentZoom + 0.25); renderAllPages();
    } else {
      setHtmlZoom(htmlZoom + 0.1);
    }
  } else if (modKey(e) && (e.key === '-' || e.key === '_')) {
    e.preventDefault();
    if (currentLang === 'latex' && currentPdfDoc) {
      currentZoom = Math.max(0.5, currentZoom - 0.25); renderAllPages();
    } else {
      setHtmlZoom(htmlZoom - 0.1);
    }
  } else if (modKey(e) && e.key === '0') {
    e.preventDefault();
    if (currentLang === 'latex' && currentPdfDoc) {
      currentZoom = 1.5; renderAllPages();
    } else {
      setHtmlZoom(1.0);
    }
  }
});

/* ============================================================
   Settings dialog
   ============================================================ */
async function openSettings() {
  if (!hasTauri) { setStatus('Settings unavailable', 'error'); return; }
  try {
    const [s, latex, bibs] = await Promise.all([
      tauri.invoke('get_settings'),
      tauri.invoke('detect_latex_engines'),
      tauri.invoke('detect_bib_engines'),
    ]);
    appSettings = s;
    document.getElementById('cfg-default-engine').value = s.latex_engine;
    document.getElementById('cfg-bib-engine').value = s.bib_engine;
    document.getElementById('cfg-auto-rerun').checked = !!s.auto_rerun;
    document.getElementById('cfg-max-runs').value = s.max_runs;
    document.getElementById('cfg-pdf-dark').value = s.pdf_dark_mode;

    // Font fields
    document.getElementById('cfg-font-family').value = s.editor_font_family || '';
    document.getElementById('cfg-font-size').value = s.editor_font_size || 14;
    document.getElementById('cfg-line-height').value = s.editor_line_height || 1.55;
    const preset = document.getElementById('cfg-font-preset');
    preset.value = '';
    for (const opt of preset.options) {
      if (opt.value === (s.editor_font_family || '')) { preset.value = opt.value; break; }
    }
    preset.onchange = () => {
      if (preset.value) document.getElementById('cfg-font-family').value = preset.value;
    };

    // Debug: list typst fonts
    const btnList = document.getElementById('btn-list-typst-fonts');
    const listOut = document.getElementById('typst-fonts-result');
    if (btnList) {
      btnList.onclick = async () => {
        listOut.textContent = 'loading...';
        try {
          const fonts = await tauri.invoke('list_typst_fonts');
          const filterInput = document.getElementById('cfg-font-family').value
            .replace(/["',]/g, ' ').trim().toLowerCase();
          const tokens = filterInput.split(/\s+/).filter(Boolean);
          const matches = tokens.length
            ? fonts.filter(f => tokens.some(t => f.toLowerCase().includes(t)))
            : fonts;
          listOut.innerHTML = `<b>${fonts.length} fonts available to Typst</b>`
            + (tokens.length ? ` (filtered: ${matches.length})` : '')
            + '<br>'
            + matches.slice(0, 200).map(f => escapeHtml(f)).join(' &middot; ');
          console.log('Typst fonts:', fonts);
        } catch (e) {
          listOut.textContent = 'error: ' + (e.message || e);
        }
      };
    }

    // Theme fields
    const themePreset = document.getElementById('cfg-theme-preset');
    themePreset.value = s.editor_theme || 'vscode-dark';
    fillThemeColorInputsFromCurrent();

    themePreset.onchange = () => {
      // When user picks a new preset, clear overrides and refresh swatches.
      const t = BUILTIN_THEMES[themePreset.value] || BUILTIN_THEMES['vscode-dark'];
      setColorInput('cfg-theme-bg', t.bg);
      setColorInput('cfg-theme-fg', t.fg);
      setColorInput('cfg-theme-gutter-bg', t.gutterBg);
      setColorInput('cfg-theme-gutter-fg', t.gutterFg);
      setColorInput('cfg-theme-active-bg', t.activeBg);
      setColorInput('cfg-theme-cursor', t.cursor);
      setColorInput('cfg-theme-selection', t.selection);
      // Live preview
      editor.setTheme(themePreset.value);
    };

    // Each color input: live preview only (don't save until user hits Save).
    for (const inp of document.querySelectorAll('.theme-grid input[type=color]')) {
      inp.oninput = () => {
        const ov = collectThemeOverrides();
        editor.setTheme(themePreset.value, snakeToCamelOverrides(ov));
      };
    }

    document.getElementById('btn-theme-reset').onclick = () => {
      // Clear all overrides — re-fill swatches from preset, re-apply.
      themePreset.dispatchEvent(new Event('change'));
    };

    // Behaviour fields
    const cbSpell = document.getElementById('cfg-spellcheck');
    if (cbSpell) cbSpell.checked = !!s.editor_spellcheck;

    // Engine grid
    const grid = document.getElementById('engine-grid');
    grid.innerHTML = '';
    for (const eng of latex) {
      const cur = (s.latex_custom_paths || {})[eng.name] || '';
      const row = document.createElement('div');
      row.className = 'engine-row';
      row.innerHTML = `
        <div class="engine-name">
          <b>${escapeHtml(eng.name)}</b>
          ${eng.path
            ? `<span class="ok">&check; ${escapeHtml(eng.version || 'detected')}</span>`
            : `<span class="bad">&times; not in PATH</span>`}
        </div>
        <div class="engine-detected muted small">${escapeHtml(eng.path || '(set custom path below)')}</div>
        <input data-engine="${escapeHtml(eng.name)}" class="engine-custom" type="text"
               placeholder="Custom path (optional)" value="${escapeHtml(cur)}">
      `;
      grid.appendChild(row);
    }

    // Bib detection summary
    const bibInfo = bibs.map(b =>
      b.path ? `${escapeHtml(b.name)} &check;` : `${escapeHtml(b.name)} &times;`
    ).join(' &middot; ');
    document.getElementById('bib-detect').innerHTML = bibInfo;

    settingsModal.showModal();
  } catch (e) {
    setStatus('Settings error: ' + (e.message || e), 'error');
  }
}

if (btnSettings) btnSettings.addEventListener('click', openSettings);
document.getElementById('settings-cancel').addEventListener('click', () => {
  // Restore the persisted theme since live preview may have mutated it.
  applyEditorTheme();
  settingsModal.close();
});
document.getElementById('settings-save').addEventListener('click', async () => {
  const customPaths = {};
  for (const inp of document.querySelectorAll('.engine-custom')) {
    const v = inp.value.trim();
    if (v) customPaths[inp.dataset.engine] = v;
  }
  const next = {
    latex_engine: document.getElementById('cfg-default-engine').value,
    bib_engine: document.getElementById('cfg-bib-engine').value,
    auto_rerun: document.getElementById('cfg-auto-rerun').checked,
    max_runs: Math.max(1, Math.min(8, parseInt(document.getElementById('cfg-max-runs').value, 10) || 4)),
    latex_custom_paths: customPaths,
    pdf_dark_mode: document.getElementById('cfg-pdf-dark').value,
    editor_font_family: normalizeFontFamily(document.getElementById('cfg-font-family').value)
      || appSettings.editor_font_family,
    editor_font_size: Math.max(8, Math.min(48,
      parseInt(document.getElementById('cfg-font-size').value, 10) || 14)),
    editor_line_height: Math.max(1, Math.min(3,
      parseFloat(document.getElementById('cfg-line-height').value) || 1.55)),
    editor_theme: document.getElementById('cfg-theme-preset').value || 'vscode-dark',
    editor_theme_overrides: collectThemeOverrides(),
    editor_spellcheck: document.getElementById('cfg-spellcheck').checked,
  };
  try {
    await tauri.invoke('set_settings', { settings: next });
    appSettings = next;
    if (engineSel) engineSel.value = next.latex_engine;
    if (pdfThemeSel) pdfThemeSel.value = next.pdf_dark_mode;
    applyPdfTheme();
    applyEditorFont();
    applyEditorTheme();
    if (editor.setSpellcheck) editor.setSpellcheck(!!next.editor_spellcheck);
    settingsModal.close();
    setStatus('Settings saved', 'ok');
  } catch (e) {
    setStatus('Save settings failed: ' + (e.message || e), 'error');
  }
});

/* ============================================================
   Math symbols floating panel
   ============================================================ */
const symbolsPanel  = document.getElementById('symbols-panel');
const symbolsBody   = document.getElementById('symbols-body');
const symbolsFilter = document.getElementById('symbols-filter');
const btnSymbols    = document.getElementById('btn-symbols');
const btnSymbolsClose = document.getElementById('symbols-close');

function renderSymbolsPanel(query = '') {
  if (!symbolsBody) return;
  const q = query.trim().toLowerCase();
  symbolsBody.innerHTML = '';
  for (const group of SYMBOL_GROUPS) {
    const matched = q
      ? group.items.filter(it =>
          it.l.toLowerCase().includes(q)
          || (it.t || '').toLowerCase().includes(q)
          || it.c.includes(q))
      : group.items;
    if (!matched.length) continue;
    const grp = document.createElement('div');
    grp.className = 'symbols-group';
    grp.innerHTML = `<div class="symbols-group-name">${escapeHtml(group.name)}</div>`;
    const grid = document.createElement('div');
    grid.className = 'symbols-grid';
    for (const sym of matched) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'symbols-cell';
      cell.textContent = sym.c;
      cell.title = `${sym.c}  \\${sym.l}` + (sym.t ? `  /  typst: ${sym.t}` : '');
      cell.addEventListener('click', () => insertSymbol(sym));
      grid.appendChild(cell);
    }
    grp.appendChild(grid);
    symbolsBody.appendChild(grp);
  }
}

function insertSymbol(sym) {
  let text = symbolInsertText(sym, currentLang);
  // For LaTeX commands like \sqrt{} we want the caret between the braces.
  let caretOffset = text.length;
  if (currentLang !== 'typst') {
    const idx = text.indexOf('{}');
    if (idx >= 0) caretOffset = idx + 1; // between { and }
  }
  const v = editor.value;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  editor.value = v.slice(0, start) + text + v.slice(end);
  const newPos = start + caretOffset;
  editor.setSelectionRange(newPos, newPos);
  editor.focus();
  scheduleAutoCompile();
}

if (btnSymbols) btnSymbols.addEventListener('click', () => {
  symbolsPanel.classList.toggle('hidden');
  if (!symbolsPanel.classList.contains('hidden')) {
    renderSymbolsPanel('');
    symbolsFilter.value = '';
    symbolsFilter.focus();
  }
});
if (btnSymbolsClose) btnSymbolsClose.addEventListener('click',
  () => symbolsPanel.classList.add('hidden'));
if (symbolsFilter) symbolsFilter.addEventListener('input',
  () => renderSymbolsPanel(symbolsFilter.value));

/* ============================================================
   Workspace folder (VSCode-style file tree)
   ============================================================ */
let workspaceFolder = null;     // absolute path of the opened folder
let workspaceTree = null;       // root TreeNode from scan_folder
const treeOpen = new Set();     // set of paths that are expanded
const treeLoaded = new Set();   // directories whose children have been loaded

function findTreeNode(node, targetPath) {
  if (!node) return null;
  if (node.path === targetPath) return node;
  if (!node.children || !node.children.length) return null;
  for (const child of node.children) {
    const found = findTreeNode(child, targetPath);
    if (found) return found;
  }
  return null;
}

async function ensureTreeNodeLoaded(path) {
  if (!workspaceTree || treeLoaded.has(path)) return;
  const node = findTreeNode(workspaceTree, path);
  if (!node || !node.isDir) return;
  try {
    const fresh = await tauri.invoke('scan_folder_shallow', { root: path });
    node.children = fresh.children || [];
    treeLoaded.add(path);
  } catch (e) {
    setStatus('Folder load failed: ' + (e.message || e), 'error');
  }
}

async function openFolder(forcedPath = null) {
  if (!hasTauri) { setStatus('Folder open unavailable', 'error'); return; }
  let dir = forcedPath;
  if (!dir) {
    try {
      dir = await tauri.dialog.open({ directory: true, multiple: false });
    } catch (e) {
      setStatus('Open folder failed: ' + (e.message || e), 'error');
      return;
    }
    if (!dir) return;
  }
  try {
    setStatus('Scanning folder…');
    workspaceTree = await tauri.invoke('scan_folder_shallow', { root: dir });
    workspaceFolder = dir;
    treeOpen.clear();
    treeLoaded.clear();
    treeLoaded.add(dir);
    treeOpen.add(workspaceTree.path);   // root expanded by default
    document.getElementById('sb-folder-name').textContent =
      workspaceTree.name || dir;
    renderTree();
    pushRecentFile(dir);
    setStatus(`Folder: ${dir}`, 'ok');
  } catch (e) {
    setStatus('Folder scan failed: ' + (e.message || e), 'error');
  }
}

function closeFolder() {
  workspaceFolder = null;
  workspaceTree = null;
  treeOpen.clear();
  document.getElementById('sb-folder-name').textContent = '(none)';
  renderTree();
  setStatus('Folder closed');
}

async function refreshFolder() {
  if (workspaceFolder) openFolder(workspaceFolder);
}

const TREE_ICONS = {
  dirOpen: '📂', dirClosed: '📁',
  md: '📝', tex: '📄', typ: '📐', bib: '📚', other: '📃',
};

function renderTree() {
  const root = document.getElementById('sb-folder-tree');
  if (!root) return;
  root.innerHTML = '';
  if (!workspaceTree) {
    root.innerHTML = '';
    return;
  }
  // Build flat list of visible rows (children expanded only if their dir is in treeOpen)
  function emit(node, depth) {
    const row = document.createElement('div');
    row.className = 'tree-row';
    if (node.path === getCurrentFilePath()) row.classList.add('active');
    row.style.paddingLeft = (4 + depth * 14) + 'px';
    let icon = '';
    if (node.isDir) {
      const open = treeOpen.has(node.path);
      if (open) row.classList.add('open');
      icon = open ? TREE_ICONS.dirOpen : TREE_ICONS.dirClosed;
    } else {
      const ext = (node.name.split('.').pop() || '').toLowerCase();
      icon = TREE_ICONS[ext] || TREE_ICONS.other;
    }
    const chev = node.isDir
      ? '<span class="tree-chevron">▸</span>'
      : '<span class="tree-chevron"></span>';
    row.innerHTML =
      chev +
      `<span class="tree-icon">${icon}</span>` +
      `<span class="tree-name">${escapeHtml(node.name)}</span>`;
    row.title = node.path;
    row.dataset.path = node.path;
    row.dataset.isDir = node.isDir ? '1' : '0';
    root.appendChild(row);
    if (node.isDir && treeOpen.has(node.path) && node.children) {
      for (const c of node.children) emit(c, depth + 1);
    }
  }
  emit(workspaceTree, 0);
}

// Tree row click — folder toggles open/closed, file opens in a tab.
document.getElementById('sb-folder-tree').addEventListener('click', (e) => {
  const row = e.target.closest('.tree-row');
  if (!row) return;
  const path = row.dataset.path;
  if (row.dataset.isDir === '1') {
    if (treeOpen.has(path)) {
      treeOpen.delete(path);
      renderTree();
      return;
    }
    treeOpen.add(path);
    if (!treeLoaded.has(path)) {
      setStatus('Loading folder…');
      ensureTreeNodeLoaded(path).finally(() => renderTree());
    } else {
      renderTree();
    }
  } else {
    openFile(path);
  }
});

document.getElementById('sb-folder-open')?.addEventListener('click', () => openFolder());
document.getElementById('sb-folder-refresh')?.addEventListener('click', () => refreshFolder());
document.getElementById('sb-folder-close')?.addEventListener('click', () => closeFolder());
const btnOpenFolderToolbar = document.getElementById('btn-open-folder');
if (btnOpenFolderToolbar) btnOpenFolderToolbar.addEventListener('click', () => openFolder());
/* Drag & drop: file → open in tab; folder → open as workspace. */
if (hasTauri && tauri.event && tauri.event.listen) {
  tauri.event.listen('tauri://file-drop', async (event) => {
    const paths = Array.isArray(event.payload) ? event.payload : [];
    if (!paths.length) return;
    const first = paths[0];
    // Heuristic: if there's no extension, treat as folder. Backend will reject if not.
    const looksLikeFolder = !/\.[a-z0-9]{1,8}$/i.test(first);
    if (looksLikeFolder) {
      openFolder(first);
    } else {
      openFile(first);
    }
  }).catch(() => {});
}

/* ============================================================
   Pane splitter drag-to-resize
   ============================================================ */
function initSplitters() {
  const sidebarEl = document.getElementById('sidebar');
  const editorPane = document.querySelector('.editor-pane');
  if (!sidebarEl || !editorPane) return;

  const MIN_SIDEBAR = 120;
  const MIN_EDITOR  = 200;
  const MIN_PREVIEW = 200;

  for (const splitter of document.querySelectorAll('.splitter')) {
    splitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      splitter.classList.add('dragging');
      document.body.classList.add('is-dragging');

      const which = splitter.dataset.pane;
      const startX = e.clientX;
      const containerRect = document.querySelector('main.split').getBoundingClientRect();

      const sidebarStart = sidebarEl.getBoundingClientRect().width;
      const editorStart  = editorPane.getBoundingClientRect().width;
      const containerW   = containerRect.width;

      function onMove(ev) {
        const dx = ev.clientX - startX;
        if (which === 'sidebar') {
          // Resize sidebar; editor + preview share the rest.
          let next = sidebarStart + dx;
          // Clamp so editor & preview stay above their minimums.
          const maxSidebar = containerW - editorStart - MIN_PREVIEW;
          next = Math.max(MIN_SIDEBAR, Math.min(next, Math.max(MIN_SIDEBAR, maxSidebar)));
          sidebarEl.style.flex = `0 0 ${next}px`;
        } else if (which === 'editor') {
          // Resize editor pane; preview takes remaining via flex:1.
          let next = editorStart + dx;
          const sidebarNow = sidebarEl.getBoundingClientRect().width;
          const maxEditor = containerW - sidebarNow - MIN_PREVIEW;
          next = Math.max(MIN_EDITOR, Math.min(next, Math.max(MIN_EDITOR, maxEditor)));
          editorPane.style.flex = `0 0 ${next}px`;
          editorPane.style.width = next + 'px';
        }
      }
      function onUp(ev) {
        splitter.classList.remove('dragging');
        document.body.classList.remove('is-dragging');
        try { splitter.releasePointerCapture(e.pointerId); } catch (_) {}
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        savePaneSizes();
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });

    // Double-click → reset to default
    splitter.addEventListener('dblclick', () => {
      if (splitter.dataset.pane === 'sidebar') {
        sidebarEl.style.flex = '0 0 240px';
      } else if (splitter.dataset.pane === 'editor') {
        editorPane.style.flex = '';
        editorPane.style.width = '50%';
      }
      savePaneSizes();
    });
  }
}

function savePaneSizes() {
  if (!hasTauri) return;
  const sidebarEl = document.getElementById('sidebar');
  const editorPane = document.querySelector('.editor-pane');
  if (!sidebarEl || !editorPane) return;
  appSettings.pane_sidebar_width = Math.round(sidebarEl.getBoundingClientRect().width);
  appSettings.pane_editor_width  = Math.round(editorPane.getBoundingClientRect().width);
  tauri.invoke('set_settings', { settings: appSettings }).catch(() => {});
}

function applyPaneSizes() {
  const sidebarEl = document.getElementById('sidebar');
  const editorPane = document.querySelector('.editor-pane');
  if (!sidebarEl || !editorPane) return;
  if (appSettings.pane_sidebar_width && appSettings.pane_sidebar_width > 80) {
    sidebarEl.style.flex = `0 0 ${appSettings.pane_sidebar_width}px`;
  }
  if (appSettings.pane_editor_width && appSettings.pane_editor_width > 80) {
    editorPane.style.flex = `0 0 ${appSettings.pane_editor_width}px`;
    editorPane.style.width = appSettings.pane_editor_width + 'px';
  }
}

initSplitters();
initWindowDragging();
const btnRecent = document.getElementById('btn-recent');
const recentMenu = document.getElementById('recent-menu');
if (btnRecent) {
  btnRecent.addEventListener('click', (e) => {
    e.stopPropagation();
    rebuildRecentMenu();
    recentMenu.classList.toggle('hidden');
  });
}
if (recentMenu) {
  recentMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.recent-item');
    if (!item) return;
    const path = item.dataset.path;
    recentMenu.classList.add('hidden');
    if (path) openFile(path);
  });
  document.addEventListener('click', (e) => {
    if (!recentMenu.contains(e.target) && e.target !== btnRecent) {
      recentMenu.classList.add('hidden');
    }
  });
}

/* ============================================================
   Command palette (Ctrl/Cmd+Shift+P)
   ============================================================ */
const cmdPalette = document.getElementById('cmd-palette');
const cmdInput   = document.getElementById('cmd-input');
const cmdList    = document.getElementById('cmd-list');
let cmdIndex = 0;
let cmdFiltered = [];

function allCommands() {
  // Each entry: { name, shortcut, when, run }
  const cmds = [
    { name: 'Open file', shortcut: 'Ctrl+O', run: () => openFile() },
    { name: 'Open folder…', shortcut: 'Ctrl+Shift+O', run: () => openFolder() },
    { name: 'Close folder', when: () => !!workspaceFolder, run: () => closeFolder() },
    { name: 'Refresh folder', when: () => !!workspaceFolder, run: () => refreshFolder() },
    { name: 'Save', shortcut: 'Ctrl+S', run: () => saveFile() },
    { name: 'Save as...', shortcut: 'Ctrl+Shift+S', run: () => saveFile({ saveAs: true }) },
    { name: 'Settings', run: () => openSettings() },
    { name: 'Toggle math symbols panel', run: () => btnSymbols.click() },
    { name: 'Switch to Markdown', run: () => setLanguage('markdown') },
    { name: 'Switch to LaTeX', run: () => setLanguage('latex') },
    { name: 'Switch to Typst', run: () => setLanguage('typst') },
  ];
  if (currentLang === 'latex') {
    cmds.push(
      { name: 'Compile (LaTeX)', shortcut: 'Ctrl+B', run: () => compileLatex() },
      { name: 'SyncTeX: jump to PDF', shortcut: 'Ctrl+Alt+J', run: () => synctexForward() },
      { name: 'Export PDF', shortcut: 'Ctrl+Shift+E',
        when: () => !!currentWorkdir, run: () => exportLatexPdf() },
      { name: 'Set current file as project main', when: () => !!currentProject.activeAbs,
        run: () => setProjectRoot(currentProject.activeAbs) },
    );
  }
  if (currentLang === 'typst') {
    cmds.push(
      { name: 'Export Typst → PDF', shortcut: 'Ctrl+Shift+E', run: () => exportTypstPdf() },
    );
  }
  return cmds.filter(c => !c.when || c.when());
}

function openCommandPalette() {
  cmdPalette.classList.remove('hidden');
  cmdInput.value = '';
  cmdInput.focus();
  filterCommands('');
}
function closeCommandPalette() { cmdPalette.classList.add('hidden'); }

function filterCommands(q) {
  q = (q || '').toLowerCase().trim();
  const all = allCommands();
  cmdFiltered = q
    ? all.filter(c => c.name.toLowerCase().includes(q))
    : all;
  cmdIndex = 0;
  renderCmdList();
}
function renderCmdList() {
  cmdList.innerHTML = '';
  cmdFiltered.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'cmd-item' + (i === cmdIndex ? ' active' : '');
    li.dataset.i = String(i);
    li.innerHTML = `<span class="cmd-name">${escapeHtml(c.name)}</span>`
      + (c.shortcut ? `<span class="cmd-shortcut">${escapeHtml(c.shortcut)}</span>` : '');
    cmdList.appendChild(li);
  });
}

if (cmdInput) {
  cmdInput.addEventListener('input', () => filterCommands(cmdInput.value));
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const c = cmdFiltered[cmdIndex];
      if (!c) return;
      closeCommandPalette();
      try { c.run(); } catch (err) { setStatus('Cmd failed: ' + (err.message || err), 'error'); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault(); cmdIndex = (cmdIndex + 1) % Math.max(1, cmdFiltered.length); renderCmdList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); cmdIndex = (cmdIndex - 1 + cmdFiltered.length) % Math.max(1, cmdFiltered.length); renderCmdList();
    }
  });
}
if (cmdList) {
  cmdList.addEventListener('click', (e) => {
    const li = e.target.closest('.cmd-item');
    if (!li) return;
    const i = parseInt(li.dataset.i, 10);
    const c = cmdFiltered[i];
    if (!c) return;
    closeCommandPalette();
    try { c.run(); } catch (err) { setStatus('Cmd failed: ' + (err.message || err), 'error'); }
  });
}
document.addEventListener('click', (e) => {
  if (!cmdPalette.contains(e.target) && !cmdPalette.classList.contains('hidden')) {
    closeCommandPalette();
  }
});

/* boot */
loadSettings().then(() => {
  rebuildRecentMenu();
  updateStatusMeta();
  updateWindowTitle();
  applyPaneSizes();
  if (hasTauri) {
    setTimeout(() => {
      renderTypst(SAMPLES.typst).catch(() => {});
    }, 0);
  }
});
// Create the initial tab (untitled, markdown). setLanguage runs inside.
{
  const first = makeTab({ lang: 'markdown' });
  tabs.push(first);
  activeTabId = first.id;
}
setLanguage('markdown');
renderTabBar();
renderTree();
editor.focus();
// Translate Ctrl→⌘ in tooltips/hints on macOS for accuracy.
if (IS_MAC) {
  for (const el of document.querySelectorAll('[title]')) {
    el.title = el.title.replace(/Ctrl\+/g, '⌘');
  }
  for (const el of document.querySelectorAll('.hint, kbd')) {
    el.innerHTML = el.innerHTML.replace(/Ctrl\+/g, '⌘');
  }
  const finderInput = document.getElementById('pdf-finder-input');
  if (finderInput) finderInput.placeholder = finderInput.placeholder.replace(/Ctrl\+/g, '⌘');
}
window.addEventListener('beforeunload', (e) => {
  if (hasTauri && currentWorkdir) {
    try { tauri.invoke('cleanup_workdir', { workdirToken: currentWorkdir }); } catch (_) {}
  }
  if (isDirty) {
    e.preventDefault();
    // Standard browser confirm prompt — Tauri WebView2 honours this on close.
    e.returnValue = '';
    return '';
  }
});
