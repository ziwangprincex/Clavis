import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import katex from 'katex';
import type { Lang } from '../store/tabs';
import { ipc } from '../api/tauri';
import { mathAt } from './writingSyntax';
import { ProseIndex } from './proseIndex';

const refresh = StateEffect.define<null>();
const cache = new Map<string, string>();
let pending: Promise<void> = Promise.resolve();
export async function formulaHtml(content: string, display: boolean, lang: Lang): Promise<string | null> {
  const key = `${lang}:${display}:${content}`;
  const found = cache.get(key);
  if (found) return found;
  let html: string | null;
  if (lang === 'typst') html = await ipc.renderFormula(content);
  else {
    try {
      html = katex.renderToString(content, {
        displayMode: display,
        throwOnError: true,
        trust: false,
        maxExpand: 500,
      });
    } catch {
      return null;
    }
  }
  if (html) {
    cache.set(key, html);
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
  }
  return html;
}
class FormulaWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly source: string,
    readonly from: number,
  ) {
    super();
  }
  eq(other: FormulaWidget) {
    return this.html === other.html && this.from === other.from;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('span');
    dom.className = 'cm-inline-formula';
    dom.innerHTML = this.html;
    dom.title = 'Click to edit formula source';
    dom.setAttribute('aria-label', this.source);
    dom.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 1 } });
      view.focus();
    });
    return dom;
  }
  ignoreEvent() {
    return true;
  }
}
export function inlineMath(language: Lang) {
  return [
    EditorView.baseTheme({
      '.cm-inline-formula': {
        display: 'inline-block',
        verticalAlign: 'middle',
        cursor: 'text',
        padding: '0 3px',
      },
      '.cm-inline-formula svg': { height: '1.5em', width: 'auto', maxWidth: '100%' },
    }),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet = Decoration.none;
        alive = true;
        requested = new Set<string>();
        visibleKeys = new Set<string>();
        index = new ProseIndex(language);
        constructor(readonly view: EditorView) {
          this.index.update(view.state.doc);
          this.build();
        }
        build() {
          const state = this.view.state,
            ranges = [];
          this.visibleKeys.clear();
          for (const viewport of this.view.visibleRanges) {
            for (
              let n = state.doc.lineAt(viewport.from).number;
              n <= state.doc.lineAt(viewport.to).number;
              n++
            ) {
              const line = state.doc.line(n);
              if (this.index.stateBefore(n)) continue;
              if (state.selection.ranges.some((r) => r.from <= line.to && r.to >= line.from)) continue;
              for (let pos = 0; pos < line.length; ) {
                const match = /\$|\\[([]/.exec(line.text.slice(pos));
                if (!match) break;
                const at = pos + match.index;
                const math = mathAt(line.text, at, language);
                pos = math ? math.to : at + 1;
                if (!math || math.content.length > 4000) continue;
                const key = `${language}:${math.display}:${math.content}`,
                  html = cache.get(key);
                this.visibleKeys.add(key);
                if (html)
                  ranges.push(
                    Decoration.replace({
                      widget: new FormulaWidget(html, math.content, line.from + math.from),
                    }).range(line.from + math.from, line.from + math.to),
                  );
                else if (!this.requested.has(key)) {
                  this.requested.add(key);
                  pending = pending.then(async () => {
                    if (!this.alive || !this.visibleKeys.has(key)) {
                      this.requested.delete(key);
                      return;
                    }
                    const result = await formulaHtml(math.content, math.display, language).catch(() => null);
                    if (result && this.alive) this.view.dispatch({ effects: refresh.of(null) });
                    if (this.requested.size > 256)
                      this.requested.delete(this.requested.values().next().value!);
                  });
                }
              }
            }
          }
          this.decorations = Decoration.set(ranges, true);
        }
        update(update: ViewUpdate) {
          if (update.docChanged) {
            let first = update.state.doc.lines,
              last = 1;
            update.changes.iterChangedRanges((_a, _b, from, to) => {
              first = Math.min(first, update.state.doc.lineAt(from).number);
              last = Math.max(last, update.state.doc.lineAt(to).number);
            });
            this.index.update(
              update.state.doc,
              first,
              last,
              update.state.doc.lines - update.startState.doc.lines,
            );
          }
          if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged ||
            update.transactions.some((t) => t.effects.some((e) => e.is(refresh)))
          )
            this.build();
        }
        destroy() {
          this.alive = false;
        }
      },
      { decorations: (p) => p.decorations },
    ),
  ];
}
