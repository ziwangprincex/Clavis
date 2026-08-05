// EditorPane — React wrapper around the CodeMirror EditorController.
//
// Strategy:
// - Single EditorView per EditorPane mount.
// - When the active tab id changes, push the new tab's content/lang into the
//   existing view via setValue + setLanguage (no re-mount).
// - Caller wires controller.onChange to a tabs store update (debounced if
//   needed) by passing onContentChange.

import { useEffect, useRef } from 'react';
import { useTabsStore, useSettingsStore, useCursorStore, useProjectStore, type Lang } from '../store';
import { EditorController } from '../editor/controller';
import { prefetchCwlForDocument, setCwlOptions } from '../completions/cwlProvider';
import { prefetchTypstSignatures } from '../completions/signatures';
import { useResolvedThemeSpec } from '../theme/appTheme';
import { normalizePath } from '../files/projectPaths';
import styles from './EditorPane.module.css';

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
function insertCiteAtCursor(ctrl: EditorController, key: string): void {
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

export interface EditorPaneRef {
  scrollToLine: (line: number) => void;
  focus: () => void;
  insertAtCursor: (text: string) => void;
  cursorLine: () => number;
  insertCite: (key: string) => void;
}

export interface EditorPaneProps {
  /** Optional ref-like callback to expose imperative methods to the parent. */
  onReady?: (api: EditorPaneRef) => void;
  /** Ctrl/Cmd+click on \input{...}/\include{...} (LaTeX). Receives the raw path
   *  and whether the macro is import-family. */
  onOpenInclude?: (raw: string, isImport: boolean) => void;
}

export function EditorPane({ onReady, onOpenInclude }: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EditorController | null>(null);
  // Keep the latest onOpenInclude reachable from the once-created controller.
  const onOpenIncludeRef = useRef(onOpenInclude);
  onOpenIncludeRef.current = onOpenInclude;

  const activeTabId = useTabsStore(s => s.activeTabId);
  const activeTab = useTabsStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const patchTab = useTabsStore(s => s.patchTab);

  const settings = useSettingsStore(s => s.settings);
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
        family: settings.editor_font_family,
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
      onCursor: () => {
        // Publish live cursor line/column to the global cursor store so the
        // status bar can display it. Column is computed against the doc, so
        // we go through the controller helper.
        const { line, column } = ctrl.cursorLineCol();
        useCursorStore.getState().setPos(line, column);
      },
      onOpenInclude: (raw: string, isImport: boolean) =>
        onOpenIncludeRef.current?.(raw, isImport),
    });
    controllerRef.current = ctrl;
    onReady?.({
      scrollToLine: (line: number) => ctrl.scrollLineIntoView(line),
      focus: () => ctrl.focus(),
      insertAtCursor: (text: string) => ctrl.insertAtCursor(text),
      cursorLine: () => ctrl.cursorLine(),
      insertCite: (key: string) => insertCiteAtCursor(ctrl, key),
    });
    return () => {
      ctrl.destroy();
      controllerRef.current = null;
    };
    // We deliberately mount once and update via dispatch effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab switch: swap content + language without rebuilding the view.
  useEffect(() => {
    const ctrl = controllerRef.current;
    if (!ctrl || !activeTab) return;
    if (ctrl.value !== activeTab.content) ctrl.value = activeTab.content;
    ctrl.setLanguage(activeTab.lang);
    // Start reading this document's .cwl packages now. Completion never awaits
    // IPC, so warming the cache here keeps the first `\` from showing a
    // half-populated list.
    if (activeTab.lang === 'latex') prefetchCwlForDocument(activeTab.content);
    // Same reasoning for Typst: the builtin signature table arrives over IPC, and
    // a cold cache would leave the first `#` showing only hand-written snippets.
    if (activeTab.lang === 'typst') prefetchTypstSignatures();
  }, [activeTabId, activeTab]);

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
    ctrl.setFont({
      family: settings.editor_font_family,
      size: settings.editor_font_size,
      lineHeight: settings.editor_line_height,
    });
  }, [settings.editor_font_family, settings.editor_font_size, settings.editor_line_height]);

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

  // Hide unused-warning lint error from patchTab destructure when controller
  // hasn't pushed an update yet.
  void patchTab;

  return <div ref={hostRef} className={styles.host} />;
}
