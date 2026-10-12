import { t } from '../i18n';
// EditorPane — React wrapper around the CodeMirror EditorController.
//
// Strategy:
// - Single EditorView per EditorPane mount.
// - When the active tab id changes, push the new tab's content/lang into the
//   existing view via setValue + setLanguage (no re-mount).
// - Caller wires controller.onChange to a tabs store update (debounced if
//   needed) by passing onContentChange.

import { useEffect, useRef, type CSSProperties } from 'react';
import { useTabsStore, useSettingsStore, defaultSettings, useCursorStore, useProjectStore, type Lang } from '../store';
import { EditorController } from '../editor/controller';
import { prefetchCwlForDocument, setCwlOptions } from '../completions/cwlProvider';
import { prefetchTypstSignatures } from '../completions/signatures';
import { useResolvedThemeSpec } from '../theme/appTheme';
import { normalizePath, pathsEqual, resolveSyncTexFile } from '../files/projectPaths';
import { isLatexError, useCompileStore } from '../store/compile';
import { useTypstPreviewStore } from '../store/typstPreview';
import type { LineProblem } from '../editor/diagnostics';
import { hasTauri, ipc } from '../api/tauri';
import { base64, imageReadRoot as readRoot, localImagePath } from '../render/markdownView';
import { sanitizeUrl } from '../render/markdown';
import { openFileByPath } from '../files/files';
import { setStatus } from '../store/status';
import { previewTypography } from '../theme/typography';
import type { LivePreviewHost } from '../editor/livePreview';
import { formatTable } from '../editor/markdownEditing';
import styles from './EditorPane.module.css';
import { citationText, citationsText } from './citationText';

function languageForPath(path: string): Lang {
  const ext = path.toLowerCase().split('.').at(-1);
  if (ext === 'tex' || ext === 'bib' || ext === 'sty' || ext === 'cls') return 'latex';
  if (ext === 'typ') return 'typst';
  return 'markdown';
}

function completionWorkspace() {
  const tabs = useTabsStore.getState();
  const project = useProjectStore.getState();
  const active = tabs.tabs.find(tab => tab.id === tabs.activeTabId);
  const byPath = new Map<string, { path: string | null; language: Lang; text: string }>();

  for (const file of project.files) {
    if (!file.absPath || typeof file.content !== 'string') continue;
    byPath.set(normalizePath(file.absPath), {
      path: file.absPath,
      language: languageForPath(file.absPath),
      text: file.content,
    });
  }
  for (const tab of tabs.tabs) {
    const key = tab.filePath ? normalizePath(tab.filePath) : `scratch:${tab.id}`;
    byPath.set(key, { path: tab.filePath, language: tab.lang, text: tab.content });
  }

  return {
    rootPath: project.rootAbs,
    activePath: active?.filePath ?? null,
    documents: [...byPath.values()],
  };
}

/**
 * Smart \cite{} insertion — ported from ui-legacy/app.js insertCiteAtCursor.
 * If the cursor is already inside a \cite{...} group, append `, key` before
 * the closing brace. Otherwise insert a brand-new \cite{key}.
 */
function insertCiteAtCursor(ctrl: EditorController, key: string, language: Lang): void {
  if (language !== 'latex') {
    ctrl.insertAtCursor(citationText(key, language));
    return;
  }
  const cursor = ctrl.view.state.selection.main.from;
  const before = ctrl.docSlice(0, cursor);
  const after = ctrl.docSlice(cursor, ctrl.docLength);
  const openIdx = before.lastIndexOf('\\cite');
  const lastBrace = before.lastIndexOf('{');
  const lastCloseBrace = before.lastIndexOf('}');
  const inCite = openIdx >= 0 && lastBrace > openIdx && lastCloseBrace < lastBrace;

  if (inCite) {
    const closeIdx = after.indexOf('}');
    if (closeIdx >= 0) {
      const middle = after.slice(0, closeIdx);
      const sep = middle.trim().length ? ', ' : '';
      const insert = sep + key;
      const insertAt = cursor + closeIdx;
      ctrl.replaceRange(insertAt, insertAt, insert, insertAt + insert.length);
      return;
    }
  }
  const insert = `\\cite{${key}}`;
  ctrl.replaceRange(cursor, cursor, insert, cursor + insert.length);
}

// Images are re-requested whenever they scroll back into view. Loaded ones are
// kept until another document is shown; failures are not kept, so an image
// created after the reference appears once it exists.
const images = new Map<string, Promise<string | null>>();

const activeDocumentPath = () => useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId)?.filePath ?? null;


/** Opened in Clavis by Cmd+click on a relative link; other files go to their own app. */
const DOCUMENT_LINK = /\.(?:md|markdown|txt|tex|typ|bib)$/i;

const markdownHost: LivePreviewHost = {
  imageSrc(href) {
    const documentPath = activeDocumentPath();
    const path = documentPath ? localImagePath(href, documentPath) : null;
    if (!hasTauri() || !documentPath || !path) return Promise.resolve(null);
    const root = readRoot(documentPath);
    const key = `${root}\0${path}`;
    let found = images.get(key);
    if (!found) {
      found = ipc.assetPreview(root, path).then(data => data?.startsWith('data:image/') ? data : null, () => null);
      images.set(key, found);
      void found.then(data => { if (!data) images.delete(key); });
    }
    return found;
  },
  openLink(href) {
    const url = sanitizeUrl(/^www\./i.test(href) ? `https://${href}` : href);
    if (!hasTauri()) return;
    if (/^(?:https?|mailto):/i.test(url)) {
      void ipc.openExternalUrl(url).catch(error => console.warn('Could not open link', error));
      return;
    }
    // A relative link to another file beside the document, like Typora.
    const documentPath = activeDocumentPath();
    const path = documentPath ? localImagePath(href, documentPath) : null;
    if (!documentPath || !path) return;
    if (DOCUMENT_LINK.test(path)) void openFileByPath(path);
    else void ipc.openWorkspaceFile(readRoot(documentPath), path).catch(error => setStatus(String(error), 'error'));
  },
  async pasteImage(file) {
    const documentPath = activeDocumentPath();
    if (!hasTauri()) return null;
    if (!documentPath) {
      setStatus('Save the document first: images are stored beside it.', 'error');
      return null;
    }
    const extension = ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' } as Record<string, string>)[file.type] ?? file.type.slice(6);
    try {
      return await ipc.saveMarkdownImage(documentPath, extension, base64(new Uint8Array(await file.arrayBuffer())));
    } catch (error) {
      setStatus(`Image not added: ${String(error)}`, 'error');
      return null;
    }
  },
};

/** The last compile's problems that belong to `path`, by source line. */
function problemsFor(path: string | null | undefined, lang: Lang): LineProblem[] {
  if (!path) return [];
  if (lang === 'typst') {
    return useTypstPreviewStore.getState().diagnostics
      .filter(d => d.line && pathsEqual(d.file, path))
      .map(d => ({ line: d.line!, severity: d.severity, message: d.message }));
  }
  if (lang !== 'latex') return [];
  const { files, rootAbs } = useProjectStore.getState();
  return useCompileStore.getState().errors.flatMap(diag => {
    // A diagnostic without a file is the main document's.
    const file = diag.file ? resolveSyncTexFile(diag.file, files, rootAbs) : rootAbs;
    return diag.line && pathsEqual(file, path)
      ? [{ line: diag.line, severity: isLatexError(diag.kind) ? 'error' as const : 'warning' as const, message: diag.message }]
      : [];
  });
}

/** Writing measure for formatted Markdown, in em of the body text. */
const MEASURES = { narrow: '36em', medium: '44em', wide: '54em' } as const;

export interface EditorPaneRef {
  scrollToLine: (line: number) => void;
  focus: () => void;
  insertAtCursor: (text: string) => void;
  cursorLine: () => number;
  insertCite: (key: string) => void;
  insertCites: (keys: string[]) => void;
  /** Align the pipes of the Markdown table at the cursor; false outside a table. */
  formatTable: () => boolean;
}

export interface EditorPaneProps {
  /** Optional ref-like callback to expose imperative methods to the parent. */
  onReady?: (api: EditorPaneRef) => void;
  /** Ctrl/Cmd+click on \input{...}/\include{...} (LaTeX). Receives the raw path
   *  and whether the macro is import-family. */
  onOpenInclude?: (raw: string, kind: 'latex' | 'typst' | 'latex-macro' | 'latex-environment', isImport: boolean) => void;
  /** A compile problem's margin marker was clicked. */
  onShowProblems?: () => void;
}

export function EditorPane({ onReady, onOpenInclude, onShowProblems }: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EditorController | null>(null);
  // Keep the latest onOpenInclude reachable from the once-created controller.
  const onOpenIncludeRef = useRef(onOpenInclude);
  onOpenIncludeRef.current = onOpenInclude;
  const onShowProblemsRef = useRef(onShowProblems);
  onShowProblemsRef.current = onShowProblems;

  const activeTabId = useTabsStore(s => s.activeTabId);
  const activeTab = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const tabIds = useTabsStore(s => s.tabs.map(tab => tab.id).join('\0'));

  const settings = useSettingsStore(s => s.settings);
  useEffect(() => { controllerRef.current?.setLocale(settings.ui_language); }, [settings.ui_language]);
  // Single source of truth for colors, shared with the app chrome so the editor
  // and the surrounding UI always match (incl. 'auto' → OS light/dark).
  const themeSpec = useResolvedThemeSpec();

  // Mount once.
  useEffect(() => {
    if (!hostRef.current) return;
    const ctrl = new EditorController({
      parent: hostRef.current,
      initialDoc: useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId)?.content ?? '',
      lang: useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId)?.lang ?? 'markdown',
      font: {
        family: settings.editor_font_family || defaultSettings.editor_font_family,
        size: settings.editor_font_size,
        lineHeight: settings.editor_line_height,
      },
      theme: themeSpec,
      spellcheck: settings.editor_spellcheck,
      tabSize: settings.editor_tab_size,
      indentWithSpaces: settings.editor_indent_with_spaces,
      onChange: (doc: string) => {
        const id = useTabsStore.getState().activeTabId;
        if (!id) return;
        const tab = useTabsStore.getState().tabs.find(t => t.id === id);
        const wasDirty = tab?.isDirty ?? false;
        useTabsStore.getState().patchTab(id, {
          content: doc,
          isDirty: wasDirty || (tab?.content ?? '') !== doc,
        });
      },
      getCompletionWorkspace: completionWorkspace,
      onCursor: (_pos, selectionFrom, selectionTo) => {
        // Publish live cursor/selection state to the status bar. Column is
        // computed against the doc, so we go through the controller helper.
        const { line, column } = ctrl.cursorLineCol();
        useCursorStore.getState().setPos(line, column, selectionFrom, selectionTo);
      },
      onOpenInclude: (raw: string, kind: 'latex' | 'typst' | 'latex-macro' | 'latex-environment', isImport: boolean) =>
        onOpenIncludeRef.current?.(raw, kind, isImport),
      markdownHost,
      onShowProblems: () => onShowProblemsRef.current?.(),
      markdownLive: !settings.markdown_source_mode,
      onToggleMarkdownSource: () => {
        const { settings: current, patchAndSave } = useSettingsStore.getState();
        void patchAndSave({ markdown_source_mode: !current.markdown_source_mode });
      },
    });
    controllerRef.current = ctrl;
    ctrl.setLocale(useSettingsStore.getState().settings.ui_language);
    onReady?.({
      scrollToLine: (line: number) => ctrl.scrollLineIntoView(line),
      focus: () => ctrl.focus(),
      insertAtCursor: (text: string) => ctrl.insertAtCursor(text),
      cursorLine: () => ctrl.cursorLine(),
      insertCite: (key: string) => {
        const tab = useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId);
        insertCiteAtCursor(ctrl, key, tab?.lang ?? 'markdown');
      },
      formatTable: () => formatTable(ctrl.view),
      insertCites: (keys: string[]) => {
        const tab = useTabsStore.getState().tabs.find(t => t.id === useTabsStore.getState().activeTabId);
        const language = tab?.lang ?? 'markdown';
        if (keys.length === 1) insertCiteAtCursor(ctrl, keys[0], language);
        else ctrl.insertAtCursor(citationsText(keys, language));
      },
    });
    return () => {
      ctrl.destroy();
      controllerRef.current = null;
    };
    // We deliberately mount once and update via dispatch effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab switch, or text replaced from outside the editor (reload, merge): swap
  // content + language without rebuilding the view. The editor's own edits
  // come back here too and are recognized without a document comparison.
  useEffect(() => {
    controllerRef.current?.switchDocument(activeTab?.id ?? '__empty__', activeTab?.content ?? '', activeTab?.lang ?? 'markdown');
  }, [activeTabId, activeTab?.content, activeTab?.lang]);

  // Reopening or switching documents reloads images from disk.
  useEffect(() => { images.clear(); }, [activeTabId]);

  // Compile problems in the margin (Texifier): refreshed by each compile and
  // document switch; between compiles the markers follow the edited text.
  const compileErrors = useCompileStore(s => s.errors);
  const typstDiagnostics = useTypstPreviewStore(s => s.diagnostics);
  const projectFiles = useProjectStore(s => s.files);
  useEffect(() => {
    controllerRef.current?.setProblems(problemsFor(activeTab?.filePath, activeTab?.lang ?? 'markdown'));
  }, [activeTabId, activeTab?.filePath, activeTab?.lang, compileErrors, typstDiagnostics, projectFiles]);

  // Start reading this document's .cwl packages when it opens. Completion
  // never awaits IPC, so warming the cache keeps the first `\` from showing a
  // half-populated list; packages added while typing are requested by
  // completion itself. Same reasoning for the Typst builtin signature table.
  useEffect(() => {
    if (activeTab?.lang === 'latex') prefetchCwlForDocument(activeTab.content);
    if (activeTab?.lang === 'typst') prefetchTypstSignatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeTab?.lang]);

  useEffect(() => { controllerRef.current?.setInlineMath(settings.editor_inline_math); }, [settings.editor_inline_math, activeTabId]);
  useEffect(() => { controllerRef.current?.setMarkdownLive(!settings.markdown_source_mode); }, [settings.markdown_source_mode]);
  useEffect(() => { controllerRef.current?.setTypewriter(settings.editor_typewriter); }, [settings.editor_typewriter]);

  // Formatted Markdown is set in the reading typography; source stays in the editor font.
  const live = (activeTab?.lang ?? 'markdown') === 'markdown' && !settings.markdown_source_mode;

  // Completion preferences are pushed into the provider rather than read from
  // the store there, because `complete()` is synchronous and on the keystroke
  // path.
  useEffect(() => {
    setCwlOptions({
      enabled: settings.cwl_enabled,
      showUnusual: settings.cwl_show_unusual,
      respectContext: settings.cwl_respect_context,
    });
  }, [settings.cwl_enabled, settings.cwl_show_unusual, settings.cwl_respect_context]);

  // Settings live-apply.
  useEffect(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    ctrl.setFont(live ? {
      family: settings.preview_font_family || defaultSettings.preview_font_family,
      size: settings.preview_font_size,
      lineHeight: settings.preview_line_height,
    } : {
      family: settings.editor_font_family || defaultSettings.editor_font_family,
      size: settings.editor_font_size,
      lineHeight: settings.editor_line_height,
    });
  }, [live, settings.editor_font_family, settings.editor_font_size, settings.editor_line_height,
    settings.preview_font_family, settings.preview_font_size, settings.preview_line_height]);

  useEffect(() => {
    controllerRef.current?.setTheme(themeSpec);
  }, [themeSpec]);

  useEffect(() => {
    controllerRef.current?.setSpellcheck(settings.editor_spellcheck);
  }, [settings.editor_spellcheck]);

  useEffect(() => {
    controllerRef.current?.setIndent(
      settings.editor_tab_size,
      settings.editor_indent_with_spaces,
    );
  }, [settings.editor_tab_size, settings.editor_indent_with_spaces]);

  useEffect(() => {
    controllerRef.current?.retainDocuments(tabIds.split('\0'));
  }, [tabIds]);

  const typography = live
    ? { ...previewTypography(settings), '--writing-measure': MEASURES[settings.preview_reading_width] ?? MEASURES.narrow } as CSSProperties
    : undefined;
  return <div ref={hostRef} className={styles.host} data-language={activeTab?.lang ?? 'markdown'} data-live={live || undefined} style={typography} aria-label={t("Document editor")} />;
}
