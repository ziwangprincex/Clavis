// CodeMirror 6 editor instance management — kept outside React so it survives
// component re-renders. Each tab gets its own EditorState (preserved as a
// JS object on the Tab when it's not active), but a SINGLE EditorView is
// reused — created when the EditorPane mounts and torn down when it unmounts.
//
// Mirrors the textarea-shaped API in ui-legacy/editor.js, ported to TypeScript.

import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  foldGutter,
  foldKeymap,
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
  closeBracketsKeymap,
  completionKeymap,
  snippet,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import type { Lang } from '../store';
import { snippetsForLang, snippetToCM6 } from '../completions/snippets';
import { inputLinkExtension } from './inputLinks';

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

/**
 * Build a CodeMirror 6 completion source for the given language.
 *
 * The trigger word is matched against snippet `l` (label). We use a wide regex
 * — `\\?[A-Za-z#][\\w-]*` — so it captures \\section, #set, plain words, etc.
 * Falling back to `null` when nothing meaningful is being typed lets other
 * completion sources (CM's built-in word completion, future LSP-ish ones) kick
 * in without us blocking them.
 */
function buildCompletionSource(lang: Lang) {
  const items = snippetsForLang(lang);
  // Pre-compute the apply function for each snippet.
  const options = items.map(s => ({
    label: s.l,
    detail: s.d,
    type: 'snippet' as const,
    apply: snippet(snippetToCM6(s.t)),
    boost: s.l.startsWith('\\') || s.l.startsWith('#') ? 1 : 0,
  }));

  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/\\?[A-Za-z#][\w.-]*/);
    if (!word) return null;
    if (word.from === word.to && !context.explicit) return null;
    return {
      from: word.from,
      to: word.to,
      options,
      validFor: /^\\?[A-Za-z#][\w.-]*$/,
    };
  };
}

export interface ThemeSpec {
  label: string;
  dark: boolean;
  bg: string;
  fg: string;
  gutterBg: string;
  gutterFg: string;
  activeBg: string;
  cursor: string;
  selection: string;
  /** Accent color for links/selection/focus in the surrounding app chrome. */
  accent: string;
}

export const BUILTIN_THEMES: Record<string, ThemeSpec> = {
  'vscode-dark': {
    label: 'VS Code Dark',
    dark: true,
    bg: '#1e1e1e', fg: '#d4d4d4',
    gutterBg: '#1e1e1e', gutterFg: '#666',
    activeBg: '#252526', cursor: '#ffffff', selection: '#264f78',
    accent: '#4aa5ff',
  },
  'vscode-light': {
    label: 'VS Code Light',
    dark: false,
    bg: '#ffffff', fg: '#1e1e1e',
    gutterBg: '#ffffff', gutterFg: '#999',
    activeBg: '#f3f3f3', cursor: '#000000', selection: '#add6ff',
    accent: '#007aff',
  },
  'github-dark': {
    label: 'GitHub Dark',
    dark: true,
    bg: '#0d1117', fg: '#c9d1d9',
    gutterBg: '#0d1117', gutterFg: '#484f58',
    activeBg: '#161b22', cursor: '#58a6ff', selection: '#264f7833',
    accent: '#58a6ff',
  },
  'github-light': {
    label: 'GitHub Light',
    dark: false,
    bg: '#ffffff', fg: '#1f2328',
    gutterBg: '#f6f8fa', gutterFg: '#9098a3',
    activeBg: '#f6f8fa', cursor: '#1f2328', selection: '#b6e3ff',
    accent: '#0969da',
  },
  'one-dark': {
    label: 'One Dark',
    dark: true,
    bg: '#282c34', fg: '#abb2bf',
    gutterBg: '#282c34', gutterFg: '#5c6370',
    activeBg: '#2c313a', cursor: '#528bff', selection: '#3e4451',
    accent: '#61afef',
  },
  'solarized-dark': {
    label: 'Solarized Dark',
    dark: true,
    bg: '#002b36', fg: '#93a1a1',
    gutterBg: '#073642', gutterFg: '#586e75',
    activeBg: '#073642', cursor: '#fdf6e3', selection: '#073642',
    accent: '#268bd2',
  },
  'solarized-light': {
    label: 'Solarized Light',
    dark: false,
    bg: '#fdf6e3', fg: '#586e75',
    gutterBg: '#eee8d5', gutterFg: '#93a1a1',
    activeBg: '#eee8d5', cursor: '#586e75', selection: '#cae0e0',
    accent: '#268bd2',
  },
  monokai: {
    label: 'Monokai',
    dark: true,
    bg: '#272822', fg: '#f8f8f2',
    gutterBg: '#272822', gutterFg: '#75715e',
    activeBg: '#3e3d32', cursor: '#f8f8f0', selection: '#49483e',
    accent: '#66d9ef',
  },
  dracula: {
    label: 'Dracula',
    dark: true,
    bg: '#282a36', fg: '#f8f8f2',
    gutterBg: '#282a36', gutterFg: '#6272a4',
    activeBg: '#44475a', cursor: '#f8f8f0', selection: '#44475a',
    accent: '#bd93f9',
  },
  nord: {
    label: 'Nord',
    dark: true,
    bg: '#2e3440', fg: '#d8dee9',
    gutterBg: '#2e3440', gutterFg: '#4c566a',
    activeBg: '#3b4252', cursor: '#d8dee9', selection: '#434c5e',
    accent: '#88c0d0',
  },
  tomorrow: {
    label: 'Tomorrow Night',
    dark: true,
    bg: '#1d1f21', fg: '#c5c8c6',
    gutterBg: '#1d1f21', gutterFg: '#5c6370',
    activeBg: '#282a2e', cursor: '#aeafad', selection: '#373b41',
    accent: '#81a2be',
  },
  material: {
    label: 'Material Darker',
    dark: true,
    bg: '#212121', fg: '#eeffff',
    gutterBg: '#212121', gutterFg: '#545454',
    activeBg: '#2c2c2c', cursor: '#ffcc00', selection: '#3a3a3a',
    accent: '#82aaff',
  },
  gruvbox: {
    label: 'Gruvbox Dark',
    dark: true,
    bg: '#282828', fg: '#ebdbb2',
    gutterBg: '#282828', gutterFg: '#7c6f64',
    activeBg: '#3c3836', cursor: '#fe8019', selection: '#504945',
    accent: '#fabd2f',
  },
};

function buildThemeExt(spec: ThemeSpec) {
  return EditorView.theme(
    {
      '&': { backgroundColor: spec.bg, color: spec.fg, height: '100%' },
      '.cm-gutters': { backgroundColor: spec.gutterBg, color: spec.gutterFg, border: 'none' },
      '.cm-activeLine': { backgroundColor: spec.activeBg },
      '.cm-activeLineGutter': { backgroundColor: spec.activeBg, color: spec.fg },
      '.cm-cursor': { borderLeftColor: spec.cursor },
      '.cm-selectionBackground, ::selection': { backgroundColor: spec.selection },
      '.cm-selectionMatch': { backgroundColor: spec.selection },
      '.cm-content': { caretColor: spec.cursor },
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
  onCursor?: (pos: number) => void;
  /** Ctrl/Cmd+click on an \input{...}/\include{...} target (LaTeX only).
   *  Receives the resolved raw path and whether the macro is import-family;
   *  caller resolves + opens it. */
  onOpenInclude?: (raw: string, isImport: boolean) => void;
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
  private suppressEvents = false;
  private currentLang: Lang;
  private themeSpec: ThemeSpec;
  private font: FontSpec;
  private spellcheck: boolean;
  private onChangeCb?: (doc: string) => void;
  private onCursorCb?: (pos: number) => void;
  private onOpenIncludeCb?: (raw: string, isImport: boolean) => void;

  constructor(opts: EditorOptions) {
    this.currentLang = opts.lang;
    this.themeSpec = opts.theme;
    this.font = opts.font;
    this.spellcheck = opts.spellcheck;
    this.onChangeCb = opts.onChange;
    this.onCursorCb = opts.onCursor;
    this.onOpenIncludeCb = opts.onOpenInclude;

    const tabSize = opts.tabSize ?? 2;
    const indentUnitStr = opts.indentWithSpaces === false ? '\t' : ' '.repeat(tabSize);

    const exts = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      foldGutter(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      this.completionCompartment.of(
        autocompletion({ override: [buildCompletionSource(this.currentLang)] }),
      ),
      highlightSelectionMatches(),
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
      keymap.of([
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...searchKeymap,
      ]),
      this.langCompartment.of(languageExtension(this.currentLang)),
      this.includeLinkCompartment.of(this.includeLinkExt(this.currentLang)),
      EditorView.updateListener.of(update => {
        if (this.suppressEvents) return;
        if (update.docChanged) this.onChangeCb?.(this.value);
        if (update.selectionSet) this.onCursorCb?.(this.cursor);
      }),
    ];

    this.view = new EditorView({
      state: EditorState.create({ doc: opts.initialDoc, extensions: exts }),
      parent: opts.parent,
    });
  }

  destroy() {
    this.view.destroy();
  }

  // ---- textarea-shaped API ----

  get value(): string {
    return this.view.state.doc.toString();
  }

  set value(v: string) {
    this.suppressEvents = true;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: v },
      selection: { anchor: 0 },
      scrollIntoView: false,
    });
    this.suppressEvents = false;
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

  /** Clickable \input/\include links — only meaningful for LaTeX. */
  private includeLinkExt(lang: Lang) {
    if (lang !== 'latex' || !this.onOpenIncludeCb) return [];
    return inputLinkExtension((raw, isImport) => this.onOpenIncludeCb?.(raw, isImport));
  }

  setLanguage(lang: Lang) {
    this.currentLang = lang;
    this.view.dispatch({
      effects: [
        this.langCompartment.reconfigure(languageExtension(lang)),
        this.completionCompartment.reconfigure(
          autocompletion({ override: [buildCompletionSource(lang)] }),
        ),
        this.includeLinkCompartment.reconfigure(this.includeLinkExt(lang)),
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
      ],
    });
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
