// Typora-style Markdown editing. The document stays plain Markdown; syntax
// marks are hidden and blocks are drawn formatted everywhere except where the
// selection is. Styles that change line height (headings, code, quotes, list
// indents) never depend on the cursor, so moving it does not reflow the page;
// only the marks themselves appear and disappear.
//
// Inline marks come from a viewport-bounded plugin. Tables and display math
// replace whole lines, which CodeMirror only accepts from a state field.

import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  showTooltip,
  type Command,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { t } from '../i18n';
import { markdownHeadings, markdownInline, sanitizeUrl } from '../render/markdown';
import { katexHtml } from './inlineMath';
import { drawDiagram } from './mermaidDiagram';
import {
  alignColumn, columnAlign, deleteColumn, deleteRow, formatTable, insertColumn, insertRow,
  type ColumnAlign, type MarkdownImageHost,
} from './markdownEditing';

export interface LivePreviewHost extends MarkdownImageHost {
  /** Resolve a relative image target to a displayable URL, or null. */
  imageSrc(href: string): Promise<string | null>;
  /** Open a link target (Cmd/Ctrl+click). */
  openLink(href: string): void;
}

/** Typora's extended inline syntax and the class its text is drawn with. */
const EXTRA_MARKS: Record<string, { mark: string; cls: string }> = {
  Highlight: { mark: 'HighlightMark', cls: 'cm-md-highlight' },
  Superscript: { mark: 'SuperscriptMark', cls: 'cm-md-sup' },
  Subscript: { mark: 'SubscriptMark', cls: 'cm-md-sub' },
};

/** Indent of one list level, in em of the body text. */
const LIST_INDENT = 1.6;
const BULLETS = ['•', '◦', '▪'];
const hide = Decoration.replace({});

/** Source is revealed only while the editor has focus, so a document opens
 *  (and rests, while the window is in the background) fully formatted. */
export const markdownFocus = StateEffect.define<boolean>();
const focused = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(markdownFocus) ? e.value : v), value),
});

/** A state swapped into an already focused view starts out unfocused. */
export function syncMarkdownFocus(view: EditorView) {
  const value = view.state.field(focused, false);
  if (value !== undefined && value !== view.hasFocus) view.dispatch({ effects: markdownFocus.of(view.hasFocus) });
}

/** States without the field (plain tests) behave as focused. */
function revealing(state: EditorState): boolean {
  return state.field(focused, false) !== false;
}

function touches(state: EditorState, from: number, to: number): boolean {
  return revealing(state) && state.selection.ranges.some(range => range.from <= to && range.to >= from);
}

function lineTouched(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return touches(state, line.from, line.to);
}

/** Block marks (`#`, `>`) stay hidden while their text is edited, as in Typora;
 *  only a cursor before the mark's end (Home, or inside it) reveals them. */
function beforeMark(state: EditorState, lineStart: number, markEnd: number): boolean {
  return revealing(state) && state.selection.ranges.some(range => range.from < markEnd && range.to >= lineStart);
}

/** A link or image destination; `<…>` is CommonMark's form for paths with spaces. */
function destination(state: EditorState, url: SyntaxNode): string {
  return state.sliceDoc(url.from, url.to).replace(/^<([^>]*)>$/, '$1');
}

/** Include the single space that separates a mark from its text. */
function withSpace(state: EditorState, to: number): number {
  return state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to;
}

/** Selects the widget's source when clicked, which reveals it for editing. */
function revealOnClick(view: EditorView, dom: HTMLElement, offset: (event: MouseEvent) => number) {
  dom.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    view.dispatch({ selection: { anchor: view.posAtDOM(dom) + offset(event) } });
    view.focus();
  });
}

class BulletWidget extends WidgetType {
  constructor(readonly label: string, readonly width: number, readonly task: { checked: boolean; at: number } | null) {
    super();
  }
  eq(other: BulletWidget) {
    return other.label === this.label && other.width === this.width
      && other.task?.checked === this.task?.checked && other.task?.at === this.task?.at;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('span');
    dom.className = 'cm-md-bullet';
    dom.style.width = `${this.width}em`;
    const task = this.task;
    if (!task) {
      dom.textContent = this.label;
      return dom;
    }
    // Drawn rather than native, so its size and position follow the text.
    const box = document.createElement('span');
    box.className = 'cm-md-task';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(task.checked));
    if (task.checked) box.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 6.3 5 8.6 9.4 3.8"/></svg>';
    box.addEventListener('mousedown', event => {
      event.preventDefault();
      view.dispatch({ changes: { from: task.at, to: task.at + 1, insert: task.checked ? ' ' : 'x' } });
    });
    dom.append(box);
    return dom;
  }
}

/** A fence line's language label; without one a zero-width space keeps the
 *  line's height, as an emptied line would otherwise collapse. */
class FenceWidget extends WidgetType {
  constructor(readonly info: string) { super(); }
  eq(other: FenceWidget) { return other.info === this.info; }
  toDOM() {
    const dom = document.createElement('span');
    dom.className = 'cm-md-fence-label';
    dom.textContent = this.info || '\u200b';
    return dom;
  }
}

const CALLOUT = /^\s{0,3}>\s?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
const CALLOUT_LABELS: Record<string, string> = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };

class CalloutLabelWidget extends WidgetType {
  constructor(readonly kind: string) { super(); }
  eq(other: CalloutLabelWidget) { return other.kind === this.kind; }
  toDOM() {
    const dom = document.createElement('span');
    dom.className = 'cm-md-callout-label';
    dom.textContent = t(CALLOUT_LABELS[this.kind]);
    return dom;
  }
}

class RuleWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const dom = document.createElement('span');
    dom.className = 'cm-md-rule';
    return dom;
  }
}

class MathWidget extends WidgetType {
  constructor(readonly html: string, readonly display: boolean, readonly offset: number) { super(); }
  eq(other: MathWidget) {
    return other.html === this.html && other.display === this.display && other.offset === this.offset;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement(this.display ? 'div' : 'span');
    dom.className = this.display ? 'cm-md-math-block' : 'cm-md-math';
    dom.innerHTML = this.html;
    revealOnClick(view, dom, () => this.offset);
    return dom;
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly href: string, readonly alt: string, readonly block: boolean, readonly host: LivePreviewHost) {
    super();
  }
  eq(other: ImageWidget) {
    return other.href === this.href && other.alt === this.alt && other.block === this.block;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('span');
    dom.className = this.block ? 'cm-md-image cm-md-image-block' : 'cm-md-image';
    const image = document.createElement('img');
    image.alt = this.alt;
    const missing = () => {
      dom.classList.add('cm-md-image-missing');
      dom.textContent = t('Image unavailable: {path}', { path: this.href });
    };
    image.addEventListener('load', () => view.requestMeasure());
    // Remote images are blocked by the app's content security policy.
    image.addEventListener('error', missing);
    dom.append(image);
    const direct = sanitizeUrl(this.href, true);
    if (/^(?:https?|data):/i.test(direct)) image.src = direct;
    else void this.host.imageSrc(this.href).catch(() => null).then(src => {
      if (src) image.src = src;
      else missing();
    });
    revealOnClick(view, dom, () => 2);
    return dom;
  }
}

/** A ```mermaid fence drawn as its diagram; `preview` sits under the source being edited. */
class DiagramWidget extends WidgetType {
  constructor(readonly source: string, readonly dark: boolean, readonly offset: number, readonly preview: boolean) { super(); }
  eq(other: DiagramWidget) {
    return other.source === this.source && other.dark === this.dark && other.offset === this.offset && other.preview === this.preview;
  }
  get estimatedHeight() { return 160; }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = this.preview ? 'cm-md-diagram cm-md-diagram-preview' : 'cm-md-diagram';
    dom.textContent = t('Drawing diagram…');
    void drawDiagram(this.source, this.dark).then(svg => {
      dom.innerHTML = svg;
    }, (error: unknown) => {
      dom.classList.add('cm-md-diagram-error');
      const message = String(error instanceof Error ? error.message : error).split('\n')[0];
      dom.textContent = t('Diagram not drawn: {error}', { error: message });
    }).finally(() => view.requestMeasure());
    if (!this.preview) revealOnClick(view, dom, () => this.offset);
    return dom;
  }
  ignoreEvent() { return !this.preview; }
}

/** The diagram source of a closed ```mermaid fence, or null for any other code block. */
function diagramSource(state: EditorState, node: SyntaxNode): string | null {
  const info = node.getChild('CodeInfo');
  if (!info || state.sliceDoc(info.from, info.to).trim().toLowerCase() !== 'mermaid') return null;
  if (node.getChildren('CodeMark').length < 2) return null;
  const text = node.getChild('CodeText');
  return text ? state.sliceDoc(text.from, text.to) : null;
}

class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly html: string, readonly host: LivePreviewHost) { super(); }
  eq(other: TableWidget) { return other.source === this.source; }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'cm-md-table';
    dom.innerHTML = this.html;
    // The cell renderer leaves relative images for the host to resolve.
    for (const image of dom.querySelectorAll<HTMLImageElement>('img[data-local-image]')) {
      image.addEventListener('load', () => view.requestMeasure());
      void this.host.imageSrc(image.dataset.localImage!).catch(() => null).then(src => {
        if (src) image.src = src;
        else image.replaceWith(t('Image unavailable: {path}', { path: image.dataset.localImage! }));
      });
    }
    revealOnClick(view, dom, event =>
      Number((event.target as Element).closest('[data-offset]')?.getAttribute('data-offset') ?? 0));
    return dom;
  }
}

// ---- Inline marks and line styles (visible ranges only) ----

/** `indent` is in em; `hanging` pulls the first text line back over its bullet. */
interface LineStyle { classes: Set<string>; indent?: number; hanging?: boolean }

/** Exported for tests, which have a state and ranges but no DOM. */
export function inlineDecorations(view: Pick<EditorView, 'state' | 'visibleRanges'>, host: LivePreviewHost): DecorationSet {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  const lines = new Map<number, LineStyle>();
  // One walk over the whole visible span: a block straddling a fold is then
  // handled once, with all of its visible lines.
  const top = view.visibleRanges[0]?.from ?? 0;
  const bottom = view.visibleRanges[view.visibleRanges.length - 1]?.to ?? 0;
  const lineAt = (pos: number) => {
    const from = state.doc.lineAt(pos).from;
    let entry = lines.get(from);
    if (!entry) lines.set(from, entry = { classes: new Set() });
    return entry;
  };
  const eachLine = (from: number, to: number, visit: (line: { from: number }, first: boolean, last: boolean) => void) => {
    const first = state.doc.lineAt(from).number, last = state.doc.lineAt(to).number;
    const start = Math.max(first, state.doc.lineAt(top).number);
    const end = Math.min(last, state.doc.lineAt(bottom).number);
    for (let n = start; n <= end; n++) visit(state.doc.line(n), n === first, n === last);
  };
  const mark = (from: number, to: number, cls: string) => {
    if (from < to) ranges.push(Decoration.mark({ class: cls }).range(from, to));
  };
  // Plugins may not replace line breaks (e.g. a link title on the next line).
  const hideInline = (from: number, to: number) => {
    if (from < to && !state.sliceDoc(from, to).includes('\n')) ranges.push(hide.range(from, to));
  };

  syntaxTree(state).iterate({
    from: top,
    to: bottom,
    enter: ref => {
      const node = ref.node;
      const name = ref.name;
      const heading = /^(ATX|Setext)Heading(\d)$/.exec(name);

      if (name === 'Table' || name === 'DisplayMath') {
        // The block field draws these; while being edited they are aligned source.
        if (touches(state, state.doc.lineAt(ref.from).from, state.doc.lineAt(ref.to).to)) {
          eachLine(ref.from, ref.to, (line, first, last) => {
            const entry = lineAt(line.from);
            entry.classes.add('cm-md-source-block');
            if (first) entry.classes.add('cm-md-source-first');
            if (last) entry.classes.add('cm-md-source-last');
          });
        }
        return false;
      }
      if (heading?.[1] === 'ATX') {
        lineAt(ref.from).classes.add(`cm-md-h${heading[2]}`);
        const marks = node.getChildren('HeaderMark');
        if (!marks[0] || beforeMark(state, ref.from, withSpace(state, marks[0].to))) return;
        ranges.push(hide.range(marks[0].from, withSpace(state, marks[0].to)));
        const closing = marks.length > 1 ? marks[marks.length - 1] : null;
        if (closing) {
          let start = closing.from;
          while (start > marks[0].to && state.sliceDoc(start - 1, start) === ' ') start--;
          ranges.push(hide.range(start, closing.to));
        }
        return;
      }
      if (heading) {
        const underline = node.getChild('HeaderMark');
        eachLine(ref.from, ref.to, (line, _first, last) => {
          if (!last) lineAt(line.from).classes.add(`cm-md-h${heading[2]}`);
          else if (underline) lineAt(line.from).classes.add('cm-md-setext');
        });
        if (underline && !touches(state, ref.from, ref.to)) ranges.push(hide.range(underline.from, underline.to));
        return;
      }
      if (name === 'Blockquote') {
        // GitHub's `> [!NOTE]` alerts, which Typora draws as callouts.
        const first = state.doc.lineAt(ref.from);
        const callout = CALLOUT.exec(first.text)?.[1].toLowerCase();
        eachLine(ref.from, ref.to, line => {
          const entry = lineAt(line.from);
          entry.classes.add('cm-md-quote');
          if (callout) entry.classes.add('cm-md-callout').add(`cm-md-callout-${callout}`);
        });
        if (callout) {
          const from = first.from + first.text.indexOf('['), to = first.from + first.text.trimEnd().length;
          if (!touches(state, from, to)) ranges.push(Decoration.replace({ widget: new CalloutLabelWidget(callout) }).range(from, to));
        }
        return;
      }
      if (name === 'QuoteMark') {
        const end = withSpace(state, ref.to);
        if (!beforeMark(state, state.doc.lineAt(ref.from).from, end)) ranges.push(hide.range(ref.from, end));
        return false;
      }
      if (name === 'FootnoteReference') {
        const label = node.getChild('FootnoteLabel');
        if (label) mark(label.from, label.to, 'cm-md-footnote-ref');
        if (label && !touches(state, ref.from, ref.to)) {
          ranges.push(hide.range(ref.from, label.from), hide.range(label.to, ref.to));
        }
        return false;
      }
      if (name === 'FootnoteDefinition') {
        lineAt(ref.from).classes.add('cm-md-footnote');
        const label = node.getChild('FootnoteMark');
        if (label) mark(label.from, label.to, 'cm-md-footnote-label');
        return;
      }
      if (name === 'Frontmatter') {
        // Metadata reads as a quiet block; its `---` lines stay compact.
        eachLine(ref.from, ref.to, (line, first, last) => {
          const entry = lineAt(line.from);
          entry.classes.add('cm-md-code');
          entry.classes.add('cm-md-frontmatter');
          if (first) entry.classes.add('cm-md-code-first');
          if (last) entry.classes.add('cm-md-code-last');
        });
        const marks = node.getChildren('FrontmatterMark');
        for (const mark of marks) lineAt(mark.from).classes.add('cm-md-fence');
        if (!touches(state, ref.from, ref.to)) {
          for (const mark of marks) ranges.push(Decoration.replace({ widget: new FenceWidget('') }).range(mark.from, mark.to));
        }
        return false;
      }
      if (name === 'FencedCode' && diagramSource(state, node) !== null && !touches(state, ref.from, ref.to)) return false;
      if (name === 'FencedCode' || name === 'CodeBlock') {
        eachLine(ref.from, ref.to, (line, first, last) => {
          const entry = lineAt(line.from);
          entry.classes.add('cm-md-code');
          if (first) entry.classes.add('cm-md-code-first');
          if (last) entry.classes.add('cm-md-code-last');
        });
        if (name === 'FencedCode') {
          // Fence lines are compact whether or not they are being edited.
          const marks = node.getChildren('CodeMark');
          const open = state.doc.lineAt(ref.from);
          const close = marks.length > 1 && marks[marks.length - 1].from > open.to ? marks[marks.length - 1] : null;
          lineAt(open.from).classes.add('cm-md-fence');
          if (close) lineAt(close.from).classes.add('cm-md-fence');
          if (!touches(state, ref.from, ref.to)) {
            const info = node.getChild('CodeInfo');
            ranges.push(Decoration.replace({
              widget: new FenceWidget(info ? state.sliceDoc(info.from, info.to) : ''),
            }).range(marks[0].from, open.to));
            lineAt(open.from).classes.add('cm-md-fence-label-line');
            if (close) ranges.push(Decoration.replace({ widget: new FenceWidget('') }).range(close.from, state.doc.lineAt(close.from).to));
          }
        }
        return false;
      }
      if (name === 'HorizontalRule') {
        if (!lineTouched(state, ref.from)) {
          ranges.push(Decoration.replace({ widget: new RuleWidget() }).range(ref.from, ref.to));
        }
        return false;
      }
      if (name === 'ListItem') {
        listItem(state, node, ranges, lineAt, top, bottom);
        return;
      }
      if (name === 'Emphasis' || name === 'StrongEmphasis' || name === 'Strikethrough') {
        if (!touches(state, ref.from, ref.to)) {
          for (const child of node.getChildren(name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark')) {
            ranges.push(hide.range(child.from, child.to));
          }
        }
        return;
      }
      const extra = EXTRA_MARKS[name];
      if (extra) {
        const marks = node.getChildren(extra.mark);
        if (marks.length >= 2) mark(marks[0].to, marks[marks.length - 1].from, extra.cls);
        if (!touches(state, ref.from, ref.to)) for (const child of marks) ranges.push(hide.range(child.from, child.to));
        return;
      }
      if (name === 'InlineCode') {
        mark(ref.from, ref.to, 'cm-md-inline-code');
        if (!touches(state, ref.from, ref.to)) {
          for (const child of node.getChildren('CodeMark')) ranges.push(hide.range(child.from, child.to));
        }
        return false;
      }
      if (name === 'InlineMath') {
        if (touches(state, ref.from, ref.to)) return false;
        const marks = node.getChildren('InlineMathMark');
        if (marks.length < 2) return false;
        const display = marks[0].to - marks[0].from === 2;
        const html = katexHtml(state.sliceDoc(marks[0].to, marks[1].from), display);
        if (html) {
          ranges.push(Decoration.replace({
            widget: new MathWidget(html, false, marks[0].to - ref.from),
          }).range(ref.from, ref.to));
        }
        return false;
      }
      if (name === 'Link') {
        const marks = node.getChildren('LinkMark');
        // `[1]` or `[sic]` without a destination stays plain text, as in the renderer.
        if (marks.length < 2 || !(node.getChild('URL') || node.getChild('LinkLabel'))) return;
        mark(marks[0].to, marks[1].from, 'cm-md-link');
        if (!touches(state, ref.from, ref.to)) {
          hideInline(marks[0].from, marks[0].to);
          hideInline(marks[1].from, ref.to);
        }
        return;
      }
      if (name === 'Image') {
        const marks = node.getChildren('LinkMark');
        const url = node.getChild('URL');
        if (!url || marks.length < 2 || touches(state, ref.from, ref.to)) return false;
        const line = state.doc.lineAt(ref.from);
        if (ref.to > line.to) return false;
        // Alone on its line (after any quote or list markers): draw full width.
        const block = !state.sliceDoc(line.from, ref.from).replace(/^(?:\s*(?:>|[-*+]|\d+[.)]))*/, '').trim()
          && !state.sliceDoc(ref.to, line.to).trim();
        ranges.push(Decoration.replace({
          widget: new ImageWidget(destination(state, url), state.sliceDoc(marks[0].to, marks[1].from), block, host),
        }).range(ref.from, ref.to));
        return false;
      }
      if (name === 'Autolink') {
        const url = node.getChild('URL');
        if (url) mark(url.from, url.to, 'cm-md-link');
        if (!touches(state, ref.from, ref.to)) {
          for (const child of node.getChildren('LinkMark')) ranges.push(hide.range(child.from, child.to));
        }
        return false;
      }
      if (name === 'URL') {
        if (!['Link', 'Image', 'LinkReference'].includes(node.parent?.name ?? '')) mark(ref.from, ref.to, 'cm-md-link');
        return false;
      }
      if (name === 'Escape') {
        if (!touches(state, ref.from, ref.to)) ranges.push(hide.range(ref.from, ref.from + 1));
        return false;
      }
    },
  });
  for (const [from, entry] of lines) {
    const quote = entry.classes.has('cm-md-quote') ? '1em + ' : '';
    const style = entry.indent === undefined ? undefined
      : `padding-left: calc(${quote}${entry.indent}em)${entry.hanging ? `; text-indent: -${entry.indent}em` : ''}`;
    ranges.push(Decoration.line({
      class: [...entry.classes].join(' '),
      attributes: style ? { style } : undefined,
    }).range(from));
  }
  return Decoration.set(ranges, true);
}

/** Bullets, numbers and task boxes in a hanging indent; continuation lines
 *  align with the item text. Inner items run later and win their own lines. */
function listItem(state: EditorState, item: SyntaxNode, ranges: Range<Decoration>[], lineAt: (pos: number) => LineStyle, top: number, bottom: number) {
  const listMark = item.getChild('ListMark');
  if (!listMark) return;
  let level = 1;
  for (let parent = item.parent; parent; parent = parent.parent) if (parent.name === 'ListItem') level++;
  const marker = state.sliceDoc(listMark.from, listMark.to);
  const ordered = /^\d/.test(marker);
  const width = (level - 1) * LIST_INDENT + (ordered ? Math.max(LIST_INDENT, 0.6 * marker.length + 0.5) : LIST_INDENT);
  const first = state.doc.lineAt(listMark.from);
  const start = first.from + (/^(?:[ \t]*>[ \t]?)*/.exec(first.text)?.[0].length ?? 0);
  const taskMarker = item.getChild('Task')?.getChild('TaskMarker');
  const end = withSpace(state, taskMarker ? taskMarker.to : listMark.to);
  const checked = !!taskMarker && /x/i.test(state.sliceDoc(taskMarker.from, taskMarker.to));
  const editing = revealing(state) && state.selection.ranges.some(range => range.from < end && range.to >= start);

  const firstLine = lineAt(first.from);
  if (!editing) {
    ranges.push(Decoration.replace({
      widget: new BulletWidget(ordered ? marker : BULLETS[(level - 1) % BULLETS.length], width,
        taskMarker ? { checked, at: taskMarker.from + 1 } : null),
    }).range(start, end));
    firstLine.indent = width;
    firstLine.hanging = true;
  } else firstLine.indent = undefined;
  if (checked) firstLine.classes.add('cm-md-task-done');
  const last = state.doc.lineAt(Math.min(item.to, bottom)).number;
  for (let n = Math.max(first.number + 1, state.doc.lineAt(top).number); n <= last; n++) {
    const entry = lineAt(state.doc.line(n).from);
    entry.indent = width;
    entry.hanging = false;
  }
}

// ---- Tables and display math (whole-line replacements) ----

/** `widget` replaces the block's lines; `preview` (display math) is shown under them while they are edited. */
interface Block { from: number; to: number; widget?: WidgetType; preview?: WidgetType }

const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);

function rowCells(state: EditorState, row: SyntaxNode, base: number) {
  const text = state.sliceDoc(row.from, row.to);
  const edges = [
    ...(text.startsWith('|') ? [] : [row.from - 1]),
    ...row.getChildren('TableDelimiter').map(pipe => pipe.from),
    ...(text.trimEnd().endsWith('|') ? [] : [row.to]),
  ];
  const cells: { html: string; offset: number }[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const raw = state.sliceDoc(edges[i] + 1, edges[i + 1]);
    const offset = edges[i] + 1 + raw.length - raw.trimStart().length - base;
    cells.push({ html: markdownInline(raw.trim()), offset });
  }
  return cells;
}

function tableHtml(state: EditorState, table: SyntaxNode, base: number): string {
  let align: string[] = [];
  const rows: { head: boolean; cells: { html: string; offset: number }[] }[] = [];
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableHeader' || child.name === 'TableRow') {
      rows.push({ head: child.name === 'TableHeader', cells: rowCells(state, child, base) });
    } else if (child.name === 'TableDelimiter') {
      align = state.sliceDoc(child.from, child.to).split('|').map(spec => spec.trim()).filter(Boolean)
        .map(spec => spec.endsWith(':') ? (spec.startsWith(':') ? 'center' : 'right') : spec.startsWith(':') ? 'left' : '');
    }
  }
  const row = ({ head, cells }: typeof rows[number]) => `<tr>${cells.map((cell, i) => {
    const tag = head ? 'th' : 'td';
    return `<${tag} data-offset="${cell.offset}"${align[i] ? ` style="text-align:${align[i]}"` : ''}>${cell.html}</${tag}>`;
  }).join('')}</tr>`;
  const [head, ...body] = rows;
  return `<table>${head?.head ? `<thead>${row(head)}</thead>` : ''}<tbody>${(head?.head ? body : rows).map(row).join('')}</tbody></table>`;
}

/** Formula text between the `$$` marks, without blockquote `>` prefixes. */
function displayMathSource(state: EditorState, node: SyntaxNode): string | null {
  const marks = node.getChildren('DisplayMathMark');
  if (marks.length !== 2) return null;
  let text = '', pos = marks[0].to;
  for (const quote of node.getChildren('QuoteMark')) {
    text += state.sliceDoc(pos, quote.from);
    pos = withSpace(state, quote.to);
  }
  return (text + state.sliceDoc(pos, marks[1].from)).trim();
}

/** Typing re-runs this for the whole document, so a block whose source text is
 *  unchanged keeps its widget instead of being rendered again. */
function collectBlocks(state: EditorState, tree: Tree, host: LivePreviewHost, previous: Map<string, WidgetType>) {
  const blocks: Block[] = [];
  const widgets = new Map<string, WidgetType>();
  tree.iterate({
    enter: ref => {
      if (ref.name === 'FencedCode') {
        const source = diagramSource(state, ref.node);
        if (source === null) return false;
        const from = state.doc.lineAt(ref.from).from, to = state.doc.lineAt(ref.to).to;
        const dark = state.facet(EditorView.darkTheme);
        const key = `Diagram\0${dark}\0${state.sliceDoc(from, to)}`;
        const widget = previous.get(key) ?? widgets.get(key) ?? new DiagramWidget(source, dark, ref.from - from, false);
        widgets.set(key, widget);
        blocks.push({ from, to, widget, preview: new DiagramWidget(source, dark, 0, true) });
        return false;
      }
      if (ref.name === 'Table' || ref.name === 'DisplayMath') {
        const from = state.doc.lineAt(ref.from).from, to = state.doc.lineAt(ref.to).to;
        const source = state.sliceDoc(from, to);
        const key = `${ref.name}\0${source}`;
        let widget = previous.get(key) ?? widgets.get(key);
        if (!widget && ref.name === 'Table') widget = new TableWidget(source, tableHtml(state, ref.node, from), host);
        else if (!widget) {
          const marks = ref.node.getChildren('DisplayMathMark');
          const formula = displayMathSource(state, ref.node);
          const html = formula === null ? null : katexHtml(formula, true);
          if (html) widget = new MathWidget(html, true, marks[0].to - from);
        }
        if (widget) widgets.set(key, widget);
        if (ref.name === 'DisplayMath') {
          // An unfinished formula keeps its place under the source while it is typed.
          const preview = widget instanceof MathWidget ? widget.html : `<span class="cm-md-math-pending">${t('Formula not rendered yet')}</span>`;
          blocks.push({ from, to, widget, preview: new MathPreviewWidget(preview) });
        } else if (widget) blocks.push({ from, to, widget });
        return false;
      }
      return CONTAINERS.has(ref.name);
    },
  });
  return { blocks, widgets };
}

interface BlockState { tree: Tree; blocks: Block[]; widgets: Map<string, WidgetType>; decorations: DecorationSet }

function blockField(host: LivePreviewHost) {
  return StateField.define<BlockState>({
    create(state) {
      const tree = syntaxTree(state);
      const { blocks, widgets } = collectBlocks(state, tree, host, new Map());
      return { tree, blocks, widgets, decorations: blockDecorations(state, blocks) };
    },
    update(value, tr) {
      const tree = syntaxTree(tr.state);
      const focusChanged = tr.effects.some(effect => effect.is(markdownFocus));
      // Diagrams are drawn in the theme's light or dark palette.
      const themeChanged = tr.startState.facet(EditorView.darkTheme) !== tr.state.facet(EditorView.darkTheme);
      if (tree === value.tree && !tr.docChanged && !tr.selection && !focusChanged && !themeChanged) return value;
      const { blocks, widgets } = tree === value.tree && !tr.docChanged && !themeChanged
        ? value
        : collectBlocks(tr.state, tree, host, value.widgets);
      return { tree, blocks, widgets, decorations: blockDecorations(tr.state, blocks) };
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  });
}

/** A display formula being edited is previewed under its source, as in Typora. */
class MathPreviewWidget extends WidgetType {
  constructor(readonly html: string) { super(); }
  eq(other: MathPreviewWidget) { return other.html === this.html; }
  toDOM() {
    const dom = document.createElement('div');
    dom.className = 'cm-md-math-preview';
    dom.setAttribute('aria-hidden', 'true');
    dom.innerHTML = this.html;
    return dom;
  }
  ignoreEvent() { return false; }
}

function blockDecorations(state: EditorState, blocks: Block[]): DecorationSet {
  return Decoration.set(blocks.map(block => {
    if (!touches(state, block.from, block.to)) {
      return block.widget ? Decoration.replace({ widget: block.widget, block: true }).range(block.from, block.to) : null;
    }
    return block.preview ? Decoration.widget({ widget: block.preview, block: true, side: 1 }).range(block.to) : null;
  }).filter(range => range !== null));
}

// ---- Table toolbar (Typora's table tooltip) ----

const icon = (path: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="${path}"/></svg>`;
const TABLE_TOOLS: ({ label: string; path: string; run: Command; align?: ColumnAlign } | null)[] = [
  { label: 'Align left', path: 'M2 3h10M2 6h7M2 9h10M2 12h6', run: alignColumn('left'), align: 'left' },
  { label: 'Align center', path: 'M2 3h10M3.5 6h7M2 9h10M4 12h6', run: alignColumn('center'), align: 'center' },
  { label: 'Align right', path: 'M2 3h10M5 6h7M2 9h10M6 12h6', run: alignColumn('right'), align: 'right' },
  null,
  { label: 'Insert row below', path: 'M2 2.5h10v4H2zM7 8.5v4M5 10.5h4', run: insertRow },
  { label: 'Delete row', path: 'M2 2.5h10v4H2zM5 10.5h4', run: deleteRow },
  { label: 'Insert column right', path: 'M2.5 2h4v10h-4zM10.5 5v4M8.5 7h4', run: insertColumn },
  { label: 'Delete column', path: 'M2.5 2h4v10h-4zM8.5 7h4', run: deleteColumn },
  null,
  { label: 'Format table source', path: 'M2 4h10M2 7h10M2 10h10M5 2v10M9 2v10', run: formatTable },
];

function tableTools(pos: number): Tooltip {
  return {
    pos,
    above: true,
    arrow: false,
    create(view) {
      const dom = document.createElement('div');
      dom.className = 'cm-md-table-tools';
      dom.setAttribute('role', 'toolbar');
      dom.setAttribute('aria-label', t('Table tools'));
      // Keep the editor focused, or the table would be drawn again and the toolbar close.
      dom.addEventListener('mousedown', event => event.preventDefault());
      const aligns: { button: HTMLButtonElement; align: ColumnAlign }[] = [];
      for (const tool of TABLE_TOOLS) {
        if (!tool) {
          dom.append(Object.assign(document.createElement('span'), { className: 'cm-md-table-tools-gap' }));
          continue;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.title = t(tool.label);
        button.setAttribute('aria-label', t(tool.label));
        button.innerHTML = icon(tool.path);
        button.addEventListener('click', () => { tool.run(view); view.focus(); });
        if (tool.align) aligns.push({ button, align: tool.align });
        dom.append(button);
      }
      const sync = (state: EditorState) => {
        const align = columnAlign(state);
        for (const item of aligns) item.button.setAttribute('aria-pressed', String(item.align === align));
      };
      sync(view.state);
      return { dom, update: update => sync(update.state) };
    },
  };
}

/** Shown above a table while its source is being edited. */
const tableToolbar = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    const head = tr.state.selection.main.head;
    let start: number | null = null;
    if (revealing(tr.state)) {
      for (let node: SyntaxNode | null = syntaxTree(tr.state).resolveInner(head, -1); node; node = node.parent) {
        if (node.name === 'Table') { start = tr.state.doc.lineAt(node.from).from; break; }
      }
    }
    if (start === null) return null;
    // The same tooltip object keeps its DOM while the cursor moves inside the table.
    return value?.pos === start ? value : tableTools(start);
  },
  provide: field => showTooltip.from(field),
});

// ---- Links ----

/** The other end of a footnote: a reference's definition, or a definition's first reference. */
function footnoteTarget(state: EditorState, pos: number): number | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name !== 'FootnoteReference' && node.name !== 'FootnoteDefinition') continue;
    const id = /\[\^([^\]\s]+)\]/.exec(state.sliceDoc(node.from, Math.min(node.to, node.from + 200)))?.[1];
    const wanted = node.name === 'FootnoteReference' ? 'FootnoteDefinition' : 'FootnoteReference';
    let found: number | null = null;
    syntaxTree(state).iterate({
      enter: other => {
        if (found !== null) return false;
        if (other.name === wanted && state.sliceDoc(other.from, other.to).startsWith(`[^${id}]`)) found = other.from;
      },
    });
    return found;
  }
  return null;
}

function linkAt(state: EditorState, pos: number): string | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    const url = node.name === 'URL' ? node : node.name === 'Link' || node.name === 'Autolink' ? node.getChild('URL') : null;
    if (url) return destination(state, url);
    if (node.name === 'Paragraph') return null;
  }
  return null;
}

const theme = EditorView.baseTheme({
  // Text, quote bars, code backgrounds, rules and tables share one left edge.
  '.cm-line': { paddingInline: '0' },
  '.cm-line.cm-md-h1, .cm-line.cm-md-h2, .cm-line.cm-md-h3, .cm-line.cm-md-h4, .cm-line.cm-md-h5, .cm-line.cm-md-h6': {
    lineHeight: '1.35', paddingTop: '0.65em', paddingBottom: '0.15em',
  },
  '.cm-md-h1': { fontSize: 'var(--h1-size, 2em)', fontWeight: 'var(--h1-weight, 600)', fontFamily: 'var(--h1-font, inherit)' },
  '.cm-md-h2': { fontSize: 'var(--h2-size, 1.5em)', fontWeight: 'var(--h2-weight, 600)', fontFamily: 'var(--h2-font, inherit)' },
  '.cm-md-h3': { fontSize: 'var(--h3-size, 1.2em)', fontWeight: 'var(--h3-weight, 600)', fontFamily: 'var(--h3-font, inherit)' },
  '.cm-md-h4': { fontSize: 'var(--h4-size, 1em)', fontWeight: 'var(--h4-weight, 600)', fontFamily: 'var(--h4-font, inherit)' },
  '.cm-md-h5': { fontSize: 'var(--h5-size, 1em)', fontWeight: 'var(--h5-weight, 600)', fontFamily: 'var(--h5-font, inherit)' },
  '.cm-md-h6': { fontSize: 'var(--h6-size, 1em)', fontWeight: 'var(--h6-weight, 600)', fontFamily: 'var(--h6-font, inherit)' },
  '.cm-line.cm-md-setext': { fontSize: '0.5em', lineHeight: '1' },
  '.cm-line.cm-md-quote': {
    borderLeft: '3px solid var(--border-strong)', paddingLeft: '1em',
    color: 'var(--text-muted)', fontFamily: 'var(--quote-font, inherit)',
  },
  '.cm-line.cm-md-code': {
    fontFamily: 'var(--code-font, var(--font-mono))', fontSize: '0.88em', lineHeight: '1.6',
    background: 'var(--panel-soft)', paddingInline: '1em',
  },
  '.cm-line.cm-md-code-first': { borderTopLeftRadius: '6px', borderTopRightRadius: '6px', paddingTop: '0.5em' },
  '.cm-line.cm-md-code-last': { borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', paddingBottom: '0.5em' },
  '.cm-line.cm-md-fence': { lineHeight: '1.2', fontSize: '0.72em' },
  '.cm-line.cm-md-fence-label-line': { textAlign: 'right' },
  '.cm-md-fence-label': { color: 'var(--text-dim)', fontFamily: 'var(--font-sans)', letterSpacing: '0.02em' },
  // Tables and formulas being edited: their source in a quiet box, as Typora's input fields.
  // Ligatures would turn a table's `--` delimiters into dashes.
  '.cm-line.cm-md-source-block': {
    fontFamily: 'var(--code-font, var(--font-mono))', fontSize: '0.88em', fontVariantLigatures: 'none',
    background: 'var(--panel-soft)', paddingInline: '0.75em',
  },
  '.cm-line.cm-md-source-first': { borderTopLeftRadius: '6px', borderTopRightRadius: '6px' },
  '.cm-line.cm-md-source-last': { borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px' },
  '.cm-md-inline-code': {
    fontFamily: 'var(--inline-code-font, var(--font-mono))', fontSize: '0.88em',
    background: 'var(--panel-soft)', borderRadius: '4px', padding: '0.1em 0.3em',
  },
  '.cm-md-link': {
    color: 'var(--accent)', textDecoration: 'underline', textDecorationThickness: '1px', textUnderlineOffset: '3px',
  },
  '.cm-md-bullet': {
    display: 'inline-block', boxSizing: 'border-box', paddingRight: '0.5em', textAlign: 'right',
    textIndent: '0', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums',
  },
  '.cm-md-task': {
    display: 'inline-block', boxSizing: 'border-box', width: '0.82em', height: '0.82em', verticalAlign: '-0.06em',
    border: '1.5px solid var(--text-dim)', borderRadius: '0.22em', cursor: 'pointer',
  },
  '.cm-md-task[aria-checked=true]': { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--bg)' },
  '.cm-md-task svg': {
    display: 'block', width: '100%', height: '100%',
    fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round',
  },
  '.cm-line.cm-md-task-done': { color: 'var(--text-muted)' },
  '.cm-md-rule': {
    display: 'inline-block', width: '100%', height: '0', verticalAlign: 'middle',
    borderTop: '1px solid var(--border-strong)',
  },
  '.cm-md-math': { cursor: 'text' },
  '.cm-md-math-block': { padding: '0.6em 0', textAlign: 'center', overflowX: 'auto', cursor: 'text' },
  '.cm-md-math-preview': {
    padding: '0.6em 0', textAlign: 'center', overflowX: 'auto',
    borderBottom: '1px solid var(--border)', marginBottom: '0.3em',
  },
  '.cm-md-math-pending': { color: 'var(--text-dim)', fontSize: '0.85em' },
  '.cm-md-diagram': { padding: '0.6em 0', textAlign: 'center', overflowX: 'auto', cursor: 'text', color: 'var(--text-dim)', fontSize: '0.85em' },
  '.cm-md-diagram svg': { maxWidth: '100%', height: 'auto' },
  '.cm-md-diagram-preview': { borderBottom: '1px solid var(--border)', marginBottom: '0.3em', cursor: 'default' },
  '.cm-md-diagram-error': { color: 'var(--error)', textAlign: 'left' },
  '.cm-line.cm-md-frontmatter': { color: 'var(--text-muted)' },
  // Callouts read in full text colour, the bar and label in the kind's colour.
  '.cm-line.cm-md-callout': { color: 'var(--text)' },
  '.cm-line.cm-md-callout-note, .cm-line.cm-md-callout-important': { borderLeftColor: 'var(--accent)' },
  '.cm-line.cm-md-callout-tip': { borderLeftColor: 'var(--ok)' },
  '.cm-line.cm-md-callout-warning': { borderLeftColor: 'var(--warning)' },
  '.cm-line.cm-md-callout-caution': { borderLeftColor: 'var(--error)' },
  '.cm-md-callout-label': { fontWeight: '600' },
  '.cm-md-callout-note .cm-md-callout-label, .cm-md-callout-important .cm-md-callout-label': { color: 'var(--accent)' },
  '.cm-md-callout-tip .cm-md-callout-label': { color: 'var(--ok)' },
  '.cm-md-callout-warning .cm-md-callout-label': { color: 'var(--warning)' },
  '.cm-md-callout-caution .cm-md-callout-label': { color: 'var(--error)' },
  '.cm-md-highlight': { background: 'color-mix(in srgb, var(--warning) 30%, transparent)', borderRadius: '2px', padding: '0.05em 0' },
  // Raised and lowered without growing the line, so the paragraph keeps its rhythm.
  '.cm-md-sup': { fontSize: '0.75em', verticalAlign: 'super', lineHeight: '0' },
  '.cm-md-sub': { fontSize: '0.75em', verticalAlign: 'sub', lineHeight: '0' },
  '.cm-md-table mark': { background: 'color-mix(in srgb, var(--warning) 30%, transparent)', color: 'inherit' },
  '.cm-md-footnote-ref': { fontSize: '0.72em', verticalAlign: 'super', lineHeight: '0', color: 'var(--accent)', padding: '0 0.1em' },
  '.cm-line.cm-md-footnote': { fontSize: '0.9em', color: 'var(--text-muted)' },
  '.cm-md-footnote-label': { color: 'var(--text-dim)' },
  '.cm-md-image img': { maxHeight: '1.5em', verticalAlign: 'middle' },
  // An image alone in its paragraph is centred, as Typora does.
  '.cm-md-image-block img': { display: 'block', maxWidth: '100%', maxHeight: 'none', margin: '0.4em auto', borderRadius: '4px' },
  '.cm-md-image-block.cm-md-image-missing': { display: 'block', textAlign: 'center' },
  '.cm-md-image-missing': { color: 'var(--text-muted)', fontSize: '0.9em', fontStyle: 'italic' },
  '.cm-md-table': { overflowX: 'auto', padding: '0.4em 0', cursor: 'text' },
  '.cm-md-table-tools': { display: 'flex', alignItems: 'center', gap: '1px', padding: '3px', fontFamily: 'var(--font-sans)' },
  '.cm-md-table-tools button': {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '24px',
    padding: '0', border: 'none', borderRadius: '5px', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
  },
  '.cm-md-table-tools button:hover': { background: 'var(--panel-soft)', color: 'var(--text)' },
  '.cm-md-table-tools button[aria-pressed=true]': { background: 'var(--tint-accent)', color: 'var(--accent)' },
  '.cm-md-table-tools-gap': { width: '1px', height: '16px', margin: '0 4px', background: 'var(--border)' },
  '.cm-md-table table': { borderCollapse: 'collapse', fontSize: '0.94em', lineHeight: '1.5' },
  '.cm-md-table th, .cm-md-table td': { padding: '0.35em 0.9em', borderBottom: '1px solid var(--border)', textAlign: 'left' },
  // Rules only, no side borders: the outer cells sit on the text edges.
  '.cm-md-table th:first-child, .cm-md-table td:first-child': { paddingLeft: '0' },
  '.cm-md-table th:last-child, .cm-md-table td:last-child': { paddingRight: '0' },
  '.cm-md-table th': { fontWeight: '600', borderBottomColor: 'var(--border-strong)' },
  '.cm-md-table code': { fontFamily: 'var(--inline-code-font, var(--font-mono))', fontSize: '0.9em' },
});

/** Scroll to the heading a `#fragment` link names, using the outline's ids. */
function jumpToAnchor(view: EditorView, href: string) {
  let id: string;
  try { id = decodeURIComponent(href.slice(1)); } catch { return; }
  const heading = markdownHeadings(view.state.doc.toString()).find(item => item.id === id);
  if (!heading) return;
  const line = view.state.doc.line(Math.min(heading.line, view.state.doc.lines));
  view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }) });
}

export function markdownLivePreview(host: LivePreviewHost): Extension {
  return [
    theme,
    focused,
    tableToolbar,
    EditorView.focusChangeEffect.of((_state, focusing) => markdownFocus.of(focusing)),
    blockField(host),
    ViewPlugin.fromClass(class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = inlineDecorations(view, host); }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged
          || update.startState.field(focused) !== update.state.field(focused)
          || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          this.decorations = inlineDecorations(update.view, host);
        }
      }
    }, { decorations: plugin => plugin.decorations }),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
        const pos = view.posAtCoords(event);
        const footnote = pos == null ? null : footnoteTarget(view.state, pos);
        if (footnote !== null) {
          event.preventDefault();
          view.dispatch({ selection: { anchor: footnote }, effects: EditorView.scrollIntoView(footnote, { y: 'center' }) });
          return true;
        }
        const href = pos == null ? null : linkAt(view.state, pos);
        if (!href) return false;
        event.preventDefault();
        if (href.startsWith('#')) jumpToAnchor(view, href);
        else host.openLink(href);
        return true;
      },
    }),
  ];
}
