// CodeMirror 6 editor instance management — kept outside React so it survives
// component re-renders. Each tab gets its own EditorState (preserved as a
// JS object on the Tab when it's not active), but a SINGLE EditorView is
// reused — created when the EditorPane mounts and torn down when it unmounts.
//
// Mirrors the textarea-shaped API in ui-legacy/editor.js, ported to TypeScript.

import { EditorState, Compartment, Transaction, type StateEffect } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  placeholder,
} from '@codemirror/view';
import { history } from '@codemirror/commands';
import {
  indentOnInput,
  bracketMatching,
  StreamLanguage,
  syntaxHighlighting,
  HighlightStyle,
  indentUnit,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import {
  autocompletion,
  closeBrackets,
} from '@codemirror/autocomplete';
import { highlightSelectionMatches } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import type { Lang } from '../store';
import { buildCompletionSource, type CompletionWorkspace } from '../completions/source';
import { inputLinkExtension } from './inputLinks';
import { writingAssist } from './writingAssist';
import { inlineMath } from './inlineMath';
import { buildEditorKeymap } from './keymaps';
import { signatureTheme, signatureTooltipExt } from './signatureTooltip';
import { type ThemeSpec } from '../theme/themes';
import { withAlpha } from '../theme/colors';
export { BUILTIN_THEMES, type ThemeSpec } from '../theme/themes';
export { withAlpha } from '../theme/colors';

// Minimal Typst syntax (StreamLanguage).
const typstStream = StreamLanguage.define({
  startState: () => ({ comment: false }) as { comment: boolean },
  token(stream, state) {
    const s = state as { comment: boolean };
    if (s.comment) {
      if (stream.match(/.*?\*\//)) s.comment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/\/\*/)) {
      s.comment = true;
      return 'comment';
    }
    if (stream.match(/\/\/.*$/)) return 'comment';
    if (stream.sol() && stream.match(/=+\s.*$/)) return 'heading';
    if (stream.match(/#[A-Za-z][\w-]*/)) return 'keyword';
    if (stream.match(/\$[^$\n]*\$/)) return 'string';
    if (stream.match(/"[^"\n]*"/)) return 'string';
    if (stream.match(/\b\d+(\.\d+)?\b/)) return 'number';
    if (stream.match(/[*_]/)) return 'emphasis';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
});

function languageExtension(lang: Lang) {
  if (lang === 'markdown') return markdown();
  if (lang === 'latex') return StreamLanguage.define(stex);
  if (lang === 'typst') return typstStream;
  return [];
}

function buildThemeExt(spec: ThemeSpec) {
  return EditorView.theme(
    {
      '&': { backgroundColor: spec.bg, color: spec.fg, height: '100%' },
      '.cm-gutters': { backgroundColor: spec.gutterBg, color: spec.gutterFg, border: 'none' },
      '.cm-activeLine': { backgroundColor: spec.activeBg },
      '.cm-activeLineGutter': { backgroundColor: spec.activeBg, color: spec.fg },
      '.cm-cursor': { borderLeftColor: spec.cursor },
      // Keep mouse selections visible: CodeMirror puts its selection layer
      // below content by default, but this editor surface covers it.
      '.cm-selectionLayer': {
        zIndex: '2 !important',
        pointerEvents: 'none',
      },
      '.cm-selectionLayer .cm-selectionBackground': {
        background: `${withAlpha(spec.accent, 0.18)} !important`,
      },
      '&.cm-focused .cm-selectionLayer .cm-selectionBackground': {
        background: `${withAlpha(spec.accent, 0.26)} !important`,
      },
      '.cm-cursorLayer': { zIndex: '3 !important', pointerEvents: 'none' },
      '.cm-selectionMatch': { backgroundColor: withAlpha(spec.accent, 0.24) },
      '.cm-content': { caretColor: spec.cursor },
      // Tooltips follow the window palette, including dark writing surfaces.
      // Completion matches use weight rather than underlines or a size change.
      '.cm-tooltip': {
        backgroundColor: 'var(--bg-elevated)', color: spec.fg,
        border: '1px solid var(--border)', borderRadius: '8px',
        boxShadow: 'var(--shadow-md)',
      },
      '.cm-panels': { backgroundColor: 'var(--panel-solid)', color: spec.fg },
      '.cm-searchMatch': { backgroundColor: withAlpha(spec.accent, 0.20) },
      '.cm-searchMatch.cm-searchMatch-selected': { outline: `1px solid ${spec.accent}` },
      '.cm-foldPlaceholder': {
        backgroundColor: spec.activeBg, color: spec.fg,
        border: '1px solid var(--border)', borderRadius: '4px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete': {
        backgroundColor: 'var(--bg-elevated)',
        color: spec.fg,
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul': {
        fontFamily: 'var(--font-sans)',
        fontSize: '13px',
        fontWeight: '400',
        padding: '4px',
        minWidth: 'min(260px, 80vw)',
        maxWidth: 'min(480px, 80vw)',
        maxHeight: '264px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
        display: 'flex',
        alignItems: 'baseline',
        gap: '16px',
        padding: '6px 9px',
        lineHeight: '1.4',
        borderRadius: '4px',
        color: spec.fg,
      },
      '.cm-completionIcon': { display: 'none' },
      '.cm-completionLabel': {
        minWidth: '0',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        fontWeight: '400',
        color: spec.fg,
      },
      '.cm-completionMatchedText': {
        color: 'inherit',
        fontSize: 'inherit',
        fontWeight: '600',
        textDecoration: 'none',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li:hover': {
        backgroundColor: 'var(--panel-soft)',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--tint-accent)',
        color: spec.fg,
      },
      '.cm-completionDetail': {
        flex: '0 1 auto',
        minWidth: '0',
        maxWidth: '45%',
        marginLeft: 'auto',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        fontFamily: 'var(--font-sans)',
        fontSize: '12px',
        fontStyle: 'normal',
        fontWeight: '400',
        color: 'var(--text-muted)',
      },
    },
    { dark: spec.dark },
  );
}

// Syntax-token colors. CodeMirror's built-in `defaultHighlightStyle` is tuned
// for LIGHT backgrounds, so on any dark theme its dark-on-dark tokens become
// unreadable (the "can't see the text" bug). We ship one palette per luminance
// and pick by `spec.dark`, so headings/keywords/strings stay legible on every
// built-in theme. Base (unhighlighted) text still comes from `spec.fg`.
const darkHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#c586c0' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#9cdcfe' },
  { tag: [t.function(t.variableName), t.labelName], color: '#dcdcaa' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#4fc1ff' },
  { tag: [t.definition(t.name), t.separator], color: '#d4d4d4' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: '#4ec9b0' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#b5cea8' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#ce9178' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: '#6a9955', fontStyle: 'italic' },
  { tag: [t.heading], color: '#4ec9b0', fontWeight: 'bold' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#4aa5ff', textDecoration: 'underline' },
  { tag: [t.url, t.escape, t.special(t.string)], color: '#d7ba7d' },
  { tag: t.invalid, color: '#f14c4c' },
]);

const lightHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#af00db' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#001080' },
  { tag: [t.function(t.variableName), t.labelName], color: '#795e26' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#0070c1' },
  { tag: [t.definition(t.name), t.separator], color: '#1e1e1e' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: '#267f99' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#098658' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#a31515' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: '#008000', fontStyle: 'italic' },
  { tag: [t.heading], color: '#267f99', fontWeight: 'bold' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#0969da', textDecoration: 'underline' },
  { tag: [t.url, t.escape, t.special(t.string)], color: '#b5690f' },
  { tag: t.invalid, color: '#cd3131' },
]);

function buildHighlightExt(spec: ThemeSpec) {
  if (spec.syntax) {
    const accent = spec.syntax.name;
    const secondary = spec.syntax.keyword;
    return syntaxHighlighting(HighlightStyle.define([
      { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: secondary },
      { tag: [t.name, t.propertyName, t.macroName, t.typeName, t.tagName], color: accent },
      { tag: [t.number, t.bool, t.atom, t.string], color: spec.syntax.literal },
      { tag: [t.comment, t.meta], color: spec.syntax.comment, fontStyle: 'italic' },
      { tag: t.heading, color: spec.fg, fontWeight: '600' },
      { tag: t.strong, fontWeight: '600' },
      { tag: t.emphasis, fontStyle: 'italic' },
      { tag: t.strikethrough, textDecoration: 'line-through' },
      { tag: [t.link, t.url], color: accent, textDecoration: 'underline' },
      { tag: t.invalid, color: spec.dark ? '#e7a49b' : '#a14035' },
    ]), { fallback: true });
  }
  return syntaxHighlighting(spec.dark ? darkHighlightStyle : lightHighlightStyle, {
    fallback: true,
  });
}

export interface FontSpec {
  family: string;
  size: number;
  lineHeight: number;
}

function buildFontExt(font: FontSpec) {
  return EditorView.theme({
    '.cm-scroller': {
      fontFamily: font.family,
      fontSize: font.size + 'px',
      lineHeight: String(font.lineHeight),
    },
    // The scroller's horizontal padding centres the gutter + text together.
    // CodeMirror still owns content measurement, wrapping and selection geometry.
    '.cm-content': {
      paddingInlineStart: '12px',
      paddingInlineEnd: '8px',
      paddingBlock: '52px 160px',
    },
  });
}

export interface EditorOptions {
  parent: HTMLElement;
  initialDoc: string;
  lang: Lang;
  font: FontSpec;
  theme: ThemeSpec;
  spellcheck: boolean;
  tabSize?: number;
  indentWithSpaces?: boolean;
  onChange?: (doc: string) => void;
  onCursor?: (pos: number, selectionFrom: number, selectionTo: number) => void;
  /** Fresh Workspace snapshot used by semantic completion providers. */
  getCompletionWorkspace?: () => CompletionWorkspace | undefined;
  /** Ctrl/Cmd+click on an \input{...}/\include{...} target (LaTeX only).
   *  Receives the resolved raw path and whether the macro is import-family;
   *  caller resolves + opens it. */
  onOpenInclude?: (raw: string, kind: 'latex' | 'typst' | 'latex-macro' | 'latex-environment', isImport: boolean) => void;
}

/** Wrapper around CodeMirror EditorView with a textarea-shaped API. */
export class EditorController {
  view: EditorView;
  private langCompartment = new Compartment();
  private completionCompartment = new Compartment();
  private fontCompartment = new Compartment();
  private themeCompartment = new Compartment();
  private highlightCompartment = new Compartment();
  private spellCompartment = new Compartment();
  private indentCompartment = new Compartment();
  private tabSizeCompartment = new Compartment();
  private includeLinkCompartment = new Compartment();
  private signatureCompartment = new Compartment();
  private writingCompartment = new Compartment();
  private inlineMathCompartment = new Compartment();
  private inlineMathEnabled = false;
  private signatureThemeCompartment = new Compartment();
  private suppressEvents = false;
  private activeDocumentId: string | null = null;
  private documents = new Map<string, { state: EditorState; scroll: StateEffect<unknown> }>();
  private tabSize = 2;
  private indentWithSpaces = true;
  private currentLang: Lang;
  private themeSpec: ThemeSpec;
  private font: FontSpec;
  private spellcheck: boolean;
  private onChangeCb?: (doc: string) => void;
  private onCursorCb?: (pos: number, selectionFrom: number, selectionTo: number) => void;
  private getCompletionWorkspaceCb?: () => CompletionWorkspace | undefined;
  private onOpenIncludeCb?: (raw: string, kind: 'latex' | 'typst' | 'latex-macro' | 'latex-environment', isImport: boolean) => void;

  constructor(opts: EditorOptions) {
    this.currentLang = opts.lang;
    this.themeSpec = opts.theme;
    this.font = opts.font;
    this.spellcheck = opts.spellcheck;
    this.onChangeCb = opts.onChange;
    this.onCursorCb = opts.onCursor;
    this.getCompletionWorkspaceCb = opts.getCompletionWorkspace;
    this.onOpenIncludeCb = opts.onOpenInclude;

    this.tabSize = opts.tabSize ?? 2;
    this.indentWithSpaces = opts.indentWithSpaces !== false;
    this.view = new EditorView({
      state: this.createState(opts.initialDoc),
      parent: opts.parent,
    });
  }

  private createState(doc: string): EditorState {
    const tabSize = this.tabSize;
    const indentUnitStr = this.indentWithSpaces ? ' '.repeat(tabSize) : '\t';
    const exts = [
      lineNumbers(),
      this.writingCompartment.of(writingAssist(this.currentLang, this.getCompletionWorkspaceCb)),
      this.inlineMathCompartment.of([]),
      placeholder('Begin with a thought…'),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      this.completionCompartment.of(
        autocompletion({
          override: [buildCompletionSource(this.currentLang, this.getCompletionWorkspaceCb)],
          interactionDelay: 0,
        }),
      ),
      highlightSelectionMatches(),
      // Parameter signature panel. It publishes through the same `showTooltip`
      // facet as the completion popup, so it asks to sit above the cursor and
      // leaves the space below to the completion list.
      this.signatureCompartment.of(signatureTooltipExt(this.currentLang)),
      this.signatureThemeCompartment.of(signatureTheme(this.themeSpec)),
      this.highlightCompartment.of(buildHighlightExt(this.themeSpec)),
      this.themeCompartment.of(buildThemeExt(this.themeSpec)),
      this.fontCompartment.of(buildFontExt(this.font)),
      this.spellCompartment.of(
        EditorView.contentAttributes.of({
          spellcheck: this.spellcheck ? 'true' : 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
        }),
      ),
      this.tabSizeCompartment.of(EditorState.tabSize.of(tabSize)),
      this.indentCompartment.of(indentUnit.of(indentUnitStr)),
      EditorView.lineWrapping,
      keymap.of(buildEditorKeymap()),
      this.langCompartment.of(languageExtension(this.currentLang)),
      this.includeLinkCompartment.of(this.includeLinkExt(this.currentLang)),
      EditorView.updateListener.of(update => {
        if (this.suppressEvents) return;
        if (update.docChanged) this.onChangeCb?.(this.value);
        if (update.selectionSet) { const selection = update.state.selection.main; this.onCursorCb?.(selection.head, selection.from, selection.to); }
      }),
    ];

    return EditorState.create({ doc, extensions: exts });
  }

  /** One view, independent undo/selection/scroll for each open document. */
  switchDocument(id: string, content: string, lang: Lang) {
    if (id === this.activeDocumentId) {
      if (content !== this.value) this.value = content;
      this.setLanguage(lang);
      return;
    }
    if (this.activeDocumentId) {
      this.documents.set(this.activeDocumentId, {
        state: this.view.state,
        scroll: this.view.scrollSnapshot(),
      });
    }
    const cached = this.documents.get(id);
    this.activeDocumentId = id;
    this.currentLang = lang;
    const reusable = cached?.state.doc.toString() === content ? cached : undefined;
    this.view.setState(reusable?.state ?? this.createState(content));
    // Cached states may predate a font/theme/indent preference change.
    this.setLanguage(lang, true);
    this.setFont(this.font);
    this.setTheme(this.themeSpec);
    this.setSpellcheck(this.spellcheck);
    this.setIndent(this.tabSize, this.indentWithSpaces);
    if (reusable) this.view.dispatch({ effects: reusable.scroll });
    else this.view.scrollDOM.scrollTop = 0;
    const selection = this.view.state.selection.main;
    this.onCursorCb?.(selection.head, selection.from, selection.to);
  }

  retainDocuments(ids: readonly string[]) {
    const keep = new Set(ids);
    for (const id of this.documents.keys()) if (!keep.has(id)) this.documents.delete(id);
  }

  destroy() {
    this.documents.clear();
    this.view.destroy();
  }

  // ---- textarea-shaped API ----

  get value(): string {
    return this.view.state.doc.toString();
  }

  set value(v: string) {
    this.suppressEvents = true;
    const selection = this.view.state.selection.main;
    try {
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: v },
        selection: { anchor: Math.min(selection.anchor, v.length), head: Math.min(selection.head, v.length) },
        annotations: Transaction.addToHistory.of(false),
        scrollIntoView: false,
      });
    } finally {
      this.suppressEvents = false;
    }
  }

  get cursor(): number {
    return this.view.state.selection.main.from;
  }

  setSelection(from: number, to: number) {
    const len = this.view.state.doc.length;
    const a = Math.max(0, Math.min(from, len));
    const b = Math.max(0, Math.min(to, len));
    this.view.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true });
  }

  focus() {
    this.view.focus();
  }

  /** Clickable static local source-file references for LaTeX and Typst. */
  private includeLinkExt(lang: Lang) {
    if ((lang !== 'latex' && lang !== 'typst') || !this.onOpenIncludeCb) return [];
    return inputLinkExtension(lang, this.getCompletionWorkspaceCb, (raw, kind, isImport) => this.onOpenIncludeCb?.(raw, kind, isImport));
  }

  setLanguage(lang: Lang, force = false) {
    if (!force && this.currentLang === lang) return;
    this.currentLang = lang;
    this.view.dispatch({
      effects: [
        this.langCompartment.reconfigure(languageExtension(lang)),
        this.writingCompartment.reconfigure(writingAssist(lang, this.getCompletionWorkspaceCb)),
        this.inlineMathCompartment.reconfigure(this.inlineMathEnabled ? inlineMath(lang) : []),
        this.completionCompartment.reconfigure(
          autocompletion({
            override: [buildCompletionSource(lang, this.getCompletionWorkspaceCb)],
            interactionDelay: 0,
          }),
        ),
        this.includeLinkCompartment.reconfigure(this.includeLinkExt(lang)),
        this.signatureCompartment.reconfigure(signatureTooltipExt(lang)),
      ],
    });
  }

  setFont(font: Partial<FontSpec>) {
    if (font.family) this.font.family = font.family;
    if (font.size && font.size >= 8 && font.size <= 48) this.font.size = font.size;
    if (font.lineHeight && font.lineHeight >= 1 && font.lineHeight <= 3) {
      this.font.lineHeight = font.lineHeight;
    }
    this.view.dispatch({ effects: this.fontCompartment.reconfigure(buildFontExt(this.font)) });
  }

  setTheme(spec: ThemeSpec) {
    this.themeSpec = spec;
    this.view.dispatch({
      effects: [
        this.themeCompartment.reconfigure(buildThemeExt(spec)),
        this.highlightCompartment.reconfigure(buildHighlightExt(spec)),
        this.signatureThemeCompartment.reconfigure(signatureTheme(spec)),
      ],
    });
  }

  setInlineMath(on: boolean) {
    this.inlineMathEnabled = on;
    this.view.dispatch({ effects: this.inlineMathCompartment.reconfigure(on ? inlineMath(this.currentLang) : []) });
  }

  setSpellcheck(on: boolean) {
    this.spellcheck = on;
    this.view.dispatch({
      effects: this.spellCompartment.reconfigure(
        EditorView.contentAttributes.of({
          spellcheck: on ? 'true' : 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
        }),
      ),
    });
  }

  setIndent(tabSize: number, withSpaces: boolean) {
    this.tabSize = tabSize;
    this.indentWithSpaces = withSpaces;
    const unit = withSpaces ? ' '.repeat(Math.max(1, tabSize)) : '\t';
    this.view.dispatch({
      effects: [
        this.tabSizeCompartment.reconfigure(EditorState.tabSize.of(tabSize)),
        this.indentCompartment.reconfigure(indentUnit.of(unit)),
      ],
    });
  }

  scrollLineIntoView(line1Based: number) {
    const ln = Math.max(1, Math.min(line1Based, this.view.state.doc.lines));
    const lineObj = this.view.state.doc.line(ln);
    this.view.dispatch({
      selection: { anchor: lineObj.from },
      effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
    });
  }

  /** Insert text at the cursor, replacing any selection. */
  insertAtCursor(text: string) {
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
    });
    this.focus();
  }

  /** 1-based line number at the cursor. */
  cursorLine(): number {
    return this.view.state.doc.lineAt(this.cursor).number;
  }

  /** 1-based `{ line, column }` at the cursor. Column counts characters from
   *  the line start (surrogate pairs count as 2, matching editor conventions). */
  cursorLineCol(): { line: number; column: number } {
    const pos = this.cursor;
    const line = this.view.state.doc.lineAt(pos);
    return { line: line.number, column: pos - line.from + 1 };
  }

  /** Slice of the document around the cursor, used by smart-insert helpers. */
  docSlice(from: number, to: number): string {
    return this.view.state.sliceDoc(from, to);
  }

  /** Total document length. */
  get docLength(): number {
    return this.view.state.doc.length;
  }

  /** Apply a manual edit at an arbitrary range. */
  replaceRange(from: number, to: number, insert: string, caretAt?: number) {
    this.view.dispatch({
      changes: { from, to, insert },
      selection: caretAt !== undefined ? { anchor: caretAt } : undefined,
      scrollIntoView: true,
    });
    this.focus();
  }
}
