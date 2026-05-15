/* Clavis editor abstraction backed by CodeMirror 6.
 *
 * Exposes a textarea-shaped API so the rest of app.js doesn't need to know
 * about CodeMirror specifics. Falls back to a plain <textarea> if loading fails.
 */

import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { foldGutter, foldKeymap, indentOnInput, bracketMatching, StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { stex } from '@codemirror/legacy-modes/mode/stex';

// Minimal Typst syntax (StreamLanguage)
const typstStream = StreamLanguage.define({
  startState: () => ({ comment: false }),
  token(stream, state) {
    if (state.comment) {
      if (stream.match(/.*?\*\//)) state.comment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/\/\*/)) { state.comment = true; return 'comment'; }
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

function languageExtension(lang) {
  if (lang === 'markdown') return markdown();
  if (lang === 'latex')    return StreamLanguage.define(stex);
  if (lang === 'typst')    return typstStream;
  return [];
}

/* Built-in themes. Each is a "color spec" (background / foreground / etc.)
 * the Editor turns into a CodeMirror EditorView.theme(...) at runtime.
 * Users can pick one and override individual colors via Settings. */
export const BUILTIN_THEMES = {
  'vscode-dark': {
    label: 'VS Code Dark',
    dark: true,
    bg:        '#1e1e1e',
    fg:        '#d4d4d4',
    gutterBg:  '#1e1e1e',
    gutterFg:  '#666',
    activeBg:  '#252526',
    cursor:    '#ffffff',
    selection: '#264f78',
  },
  'github-light': {
    label: 'GitHub Light',
    dark: false,
    bg:        '#ffffff',
    fg:        '#1f2328',
    gutterBg:  '#f6f8fa',
    gutterFg:  '#9098a3',
    activeBg:  '#f6f8fa',
    cursor:    '#1f2328',
    selection: '#b6e3ff',
  },
  'solarized-light': {
    label: 'Solarized Light',
    dark: false,
    bg:        '#fdf6e3',
    fg:        '#586e75',
    gutterBg:  '#eee8d5',
    gutterFg:  '#93a1a1',
    activeBg:  '#eee8d5',
    cursor:    '#586e75',
    selection: '#cae0e0',
  },
  'solarized-dark': {
    label: 'Solarized Dark',
    dark: true,
    bg:        '#002b36',
    fg:        '#93a1a1',
    gutterBg:  '#073642',
    gutterFg:  '#586e75',
    activeBg:  '#073642',
    cursor:    '#fdf6e3',
    selection: '#073642',
  },
  'monokai': {
    label: 'Monokai',
    dark: true,
    bg:        '#272822',
    fg:        '#f8f8f2',
    gutterBg:  '#272822',
    gutterFg:  '#75715e',
    activeBg:  '#3e3d32',
    cursor:    '#f8f8f0',
    selection: '#49483e',
  },
  'one-dark': {
    label: 'One Dark',
    dark: true,
    bg:        '#282c34',
    fg:        '#abb2bf',
    gutterBg:  '#282c34',
    gutterFg:  '#5c6370',
    activeBg:  '#2c313a',
    cursor:    '#528bff',
    selection: '#3e4451',
  },
};

function buildTheme(spec) {
  const sel = spec.selection;
  return EditorView.theme({
    '&': { backgroundColor: spec.bg, color: spec.fg, height: '100%' },
    '.cm-gutters': { backgroundColor: spec.gutterBg, color: spec.gutterFg, border: 'none' },
    '.cm-activeLine': { backgroundColor: spec.activeBg },
    '.cm-activeLineGutter': { backgroundColor: spec.activeBg, color: spec.fg },
    '.cm-cursor': { borderLeftColor: spec.cursor },
    '.cm-selectionBackground, ::selection': { backgroundColor: sel },
    '.cm-selectionMatch': { backgroundColor: sel },
    '.cm-content': { caretColor: spec.cursor },
  }, { dark: spec.dark });
}

export class Editor {
  constructor(parent) {
    this.parent = parent;
    this.langCompartment = new Compartment();
    this.fontCompartment = new Compartment();
    this.themeCompartment = new Compartment();
    this.spellCompartment = new Compartment();
    this._changeCb = null;
    this._cursorCb = null;
    this._currentLang = 'markdown';
    this._suppressEvents = false;
    this._fontFamily = '"Consolas","Cascadia Code","Menlo",monospace';
    this._fontSize = 14;
    this._lineHeight = 1.55;
    this._themeSpec = { ...BUILTIN_THEMES['vscode-dark'] };
    this._spellcheck = false;
    this._buildView('');
  }

  _buildFontTheme() {
    return EditorView.theme({
      '.cm-scroller': {
        fontFamily: this._fontFamily,
        fontSize: this._fontSize + 'px',
        lineHeight: String(this._lineHeight),
      },
    });
  }

  _buildView(initialDoc) {
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
      autocompletion({ override: [] }),  // we drive completions from outside
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      this.themeCompartment.of(buildTheme(this._themeSpec)),
      this.fontCompartment.of(this._buildFontTheme()),
      this.spellCompartment.of(EditorView.contentAttributes.of({
        spellcheck: this._spellcheck ? 'true' : 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
      })),
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
      this.langCompartment.of(languageExtension(this._currentLang)),
      EditorView.updateListener.of(update => {
        if (this._suppressEvents) return;
        if (update.docChanged && this._changeCb) this._changeCb();
        if (update.selectionSet && this._cursorCb) this._cursorCb();
      }),
    ];
    this.view = new EditorView({
      state: EditorState.create({ doc: initialDoc, extensions: exts }),
      parent: this.parent,
    });
  }

  // ---- textarea-shaped API ----

  get value() { return this.view.state.doc.toString(); }
  set value(v) {
    this._suppressEvents = true;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: v ?? '' },
      selection: { anchor: 0 },
      scrollIntoView: false,
    });
    this._suppressEvents = false;
  }

  get selectionStart() { return this.view.state.selection.main.from; }
  get selectionEnd()   { return this.view.state.selection.main.to; }
  set selectionStart(p) { this.setSelectionRange(p, this.view.state.selection.main.to); }
  set selectionEnd(p)   { this.setSelectionRange(this.view.state.selection.main.from, p); }

  setSelectionRange(from, to) {
    const len = this.view.state.doc.length;
    const a = Math.max(0, Math.min(from, len));
    const b = Math.max(0, Math.min(to, len));
    this.view.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true });
  }

  focus() { this.view.focus(); }
  blur()  { this.view.contentDOM.blur(); }

  /** Underlying DOM element — for blur/scroll/keydown listeners. */
  get dom() { return this.view.contentDOM; }
  /** Underlying scrollable element. */
  get scrollDOM() { return this.view.scrollDOM; }

  /** Like a textarea: number of pixels scrolled in the inner scroller. */
  get scrollTop() { return this.view.scrollDOM.scrollTop; }
  set scrollTop(v) { this.view.scrollDOM.scrollTop = v; }

  get clientHeight() { return this.view.scrollDOM.clientHeight; }
  get clientWidth()  { return this.view.scrollDOM.clientWidth; }

  /** Caret position in CSS pixels (for popup positioning). */
  caretCoords() {
    const head = this.view.state.selection.main.head;
    const c = this.view.coordsAtPos(head);
    if (!c) return null;
    return { left: c.left, top: c.top, bottom: c.bottom };
  }

  /** Replace the editor's language extension (no doc reset). */
  setLanguage(lang) {
    this._currentLang = lang;
    this.view.dispatch({ effects: this.langCompartment.reconfigure(languageExtension(lang)) });
  }

  /** Apply font family / size / line-height live. */
  setFont({ family, size, lineHeight }) {
    if (family) this._fontFamily = family;
    if (size && size >= 8 && size <= 48) this._fontSize = size;
    if (lineHeight && lineHeight >= 1 && lineHeight <= 3) this._lineHeight = lineHeight;
    this.view.dispatch({ effects: this.fontCompartment.reconfigure(this._buildFontTheme()) });
  }

  /**
   * Apply a theme.
   *   spec can be a key into BUILTIN_THEMES, or a full spec object
   *   ({ bg, fg, gutterBg, gutterFg, activeBg, cursor, selection, dark }).
   *   Individual fields override the underlying theme.
   */
  setTheme(spec, overrides = {}) {
    let base;
    if (typeof spec === 'string') {
      base = BUILTIN_THEMES[spec] || BUILTIN_THEMES['vscode-dark'];
    } else {
      base = spec || this._themeSpec;
    }
    this._themeSpec = { ...base, ...overrides };
    this.view.dispatch({
      effects: this.themeCompartment.reconfigure(buildTheme(this._themeSpec)),
    });
  }

  /**
   * Wrap the current selection with `before` and `after`. If nothing is selected,
   * inserts `before+after` and places caret between them. Returns true if it
   * actually changed the document.
   */
  surroundSelection(before, after) {
    const { from, to } = this.view.state.selection.main;
    const text = this.view.state.sliceDoc(from, to);
    const insert = before + text + after;
    this.view.dispatch({
      changes: { from, to, insert },
      selection: text
        ? { anchor: from + before.length, head: from + before.length + text.length }
        : { anchor: from + before.length },
      scrollIntoView: true,
    });
    return true;
  }

  /** Toggle the WebView's native spellcheck. Cheap and language-agnostic. */
  setSpellcheck(on) {
    this._spellcheck = !!on;
    this.view.dispatch({
      effects: this.spellCompartment.reconfigure(EditorView.contentAttributes.of({
        spellcheck: this._spellcheck ? 'true' : 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
      })),
    });
  }

  scrollLineIntoView(line1based) {
    const ln = Math.max(1, Math.min(line1based, this.view.state.doc.lines));
    const lineObj = this.view.state.doc.line(ln);
    this.view.dispatch({
      selection: { anchor: lineObj.from },
      effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
    });
  }

  /** External listener APIs (one each). */
  onChange(cb) { this._changeCb = cb; }
  onCursorMove(cb) { this._cursorCb = cb; }

  /** Add a custom keymap (top priority). */
  addKeybinding(key, run) {
    // Easiest: use the dom-level event because top-priority keymap requires
    // re-creating the state. The textarea path used window keydown, which is
    // intercepted by CodeMirror keymap; we mirror it here.
    this.view.contentDOM.addEventListener('keydown', (e) => {
      if (matchKey(e, key)) {
        e.preventDefault();
        run();
      }
    });
  }
}

function matchKey(e, spec) {
  // very small matcher: "Ctrl-b" / "Ctrl-Alt-j" / "Ctrl-Space"
  const parts = spec.toLowerCase().split('-');
  const want = parts.pop();
  const ctrl = parts.includes('ctrl');
  const alt  = parts.includes('alt');
  const shift= parts.includes('shift');
  if (!!e.ctrlKey !== ctrl) return false;
  if (!!e.altKey  !== alt)  return false;
  if (!!e.shiftKey!== shift) return false;
  if (want === 'space') return e.code === 'Space' || e.key === ' ';
  return e.key.toLowerCase() === want;
}
