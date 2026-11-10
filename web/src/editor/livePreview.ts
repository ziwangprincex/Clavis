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
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { t } from '../i18n';
import { markdownHeadings, markdownInline, sanitizeUrl } from '../render/markdown';
import { katexHtml } from './inlineMath';
import { livePreviewTheme } from './livePreviewTheme';
import { tableToolbar } from './tableToolbar';
import { drawDiagram, drawnDiagram } from './mermaidDiagram';
import type { MarkdownImageHost } from './markdownEditing';

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
/** The last drawing previewed under a diagram's source, by the block's start:
 *  shown while the next one waits for typing to pause. */
let lastPreview: { slot: number; svg: string } | null = null;
/** Typing inside a fence makes a new source per key; draw only once it pauses. */
const PREVIEW_DELAY = 350;

class DiagramWidget extends WidgetType {
  constructor(readonly source: string, readonly dark: boolean, readonly offset: number, readonly preview: boolean, readonly slot = 0) { super(); }
  eq(other: DiagramWidget) {
    return other.source === this.source && other.dark === this.dark && other.offset === this.offset && other.preview === this.preview;
  }
  get estimatedHeight() { return 160; }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = this.preview ? 'cm-md-diagram cm-md-diagram-preview' : 'cm-md-diagram';
    const ready = drawnDiagram(this.source, this.dark);
    if (ready !== undefined) this.show(dom, ready);
    else if (this.preview) {
      if (lastPreview?.slot === this.slot) {
        dom.innerHTML = lastPreview.svg;
        dom.classList.add('cm-md-diagram-pending');
      } else dom.textContent = t('Drawing diagram…');
      // A newer keystroke replaces this widget, and its timer then finds it gone.
      setTimeout(() => { if (dom.isConnected) this.draw(view, dom); }, PREVIEW_DELAY);
    } else {
      dom.textContent = t('Drawing diagram…');
      this.draw(view, dom);
    }
    if (!this.preview) revealOnClick(view, dom, () => this.offset);
    return dom;
  }
  private show(dom: HTMLElement, svg: string) {
    dom.innerHTML = svg;
    dom.classList.remove('cm-md-diagram-pending');
    if (this.preview) lastPreview = { slot: this.slot, svg };
  }
  private draw(view: EditorView, dom: HTMLElement) {
    void drawDiagram(this.source, this.dark).then(svg => this.show(dom, svg), (error: unknown) => {
      dom.classList.remove('cm-md-diagram-pending');
      dom.classList.add('cm-md-diagram-error');
      const message = String(error instanceof Error ? error.message : error).split('\n')[0];
      dom.textContent = t('Diagram not drawn: {error}', { error: message });
    }).finally(() => view.requestMeasure());
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
        blocks.push({ from, to, widget, preview: new DiagramWidget(source, dark, 0, true, from) });
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
    livePreviewTheme,
    focused,
    tableToolbar(revealing),
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
