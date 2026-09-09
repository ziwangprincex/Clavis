import {
  EditorView,
  hoverTooltip,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { foldService, foldGutter, codeFolding } from '@codemirror/language';
import katex from 'katex';
import type { Lang } from '../store/tabs';
import type { CompletionWorkspace } from '../completions/types';
import { foldRange, mathAt } from './writingSyntax';
import { hasTauri, ipc } from '../api/tauri';
import { ProseIndex } from './proseIndex';

export function writingAssist(language: Lang, workspace?: () => CompletionWorkspace | undefined) {
  return [
    codeFolding(),
    foldGutter(),
    foldService.of((state, from) => {
      const line = state.doc.lineAt(from).text;
      if (
        language === 'latex'
          ? !/^\s*\\(?:part|chapter|section|subsection|subsubsection|paragraph|begin)\b/.test(line)
          : !/^\s*[=#]+\s/.test(line)
      )
        return null;
      return foldRange(state.doc.toString(), from, language);
    }),
    EditorView.baseTheme({
      '.cm-writing-hover': {
        padding: '12px 16px',
        maxWidth: '440px',
        maxHeight: '260px',
        overflow: 'auto',
        fontSize: '1.0rem',
        lineHeight: '1.6',
      },
      '.cm-writing-hover svg': { maxWidth: '400px', maxHeight: '220px' },
      '.cm-writing-hover pre': { whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '4px 0' },
      '.cm-foldGutter': { opacity: '.5' },
    }),
    hoverTooltip(
      async (view, pos) => {
        const document = view.state.doc;
        const text = document.toString();
        const math = mathAt(text, pos, language);
        if (math && math.content.length <= 4000) {
          let html = '';
          if (language === 'typst') {
            if (!hasTauri()) return null;
            const result = await ipc.renderFormula(math.content).catch(() => null);
            if (!result) return null;
            html = result;
          } else {
            try {
              html = katex.renderToString(math.content, {
                displayMode: math.display,
                throwOnError: true,
                trust: false,
                maxExpand: 500,
              });
            } catch {
              return null;
            }
          }
          if (view.state.doc !== document) return null;
          return {
            pos: math.from,
            end: math.to,
            above: true,
            create: () => {
              const dom = window.document.createElement('div');
              dom.className = 'cm-writing-hover';
              dom.innerHTML = html;
              dom.title =
                language === 'typst'
                  ? 'Isolated formula preview; document definitions are not included'
                  : 'KaTeX preview; document macros may require full compilation';
              return { dom };
            },
          };
        }
        const line = document.lineAt(pos);
        const pattern =
          language === 'latex'
            ? /\\(?:[a-zA-Z]*cite[a-zA-Z]*|(?:eq|page|auto|c|C)?ref)\*?(?:\[[^\]]*\])*\{([^}]+)\}/g
            : /@([\w:.-]+)/g;
        const match = [...line.text.matchAll(pattern)].find(
          (m) => pos >= line.from + m.index! && pos < line.from + m.index! + m[0].length,
        );
        if (!match) return null;
        const key = match[1].split(',')[0].trim();
        const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const definitions = new RegExp(
          `\\\\label\\s*\\{${safe}\\}|<${safe}>|@[A-Za-z]+\\s*\\{\\s*${safe}\\s*,`,
        );
        const scope = workspace?.();
        const directory = scope?.rootPath?.replace(/[\\/][^\\/]*$/, '');
        const docs = (scope?.documents ?? [{ path: null, text, language }]).filter(
          (doc) => !directory || !doc.path || doc.path.startsWith(directory + '/'),
        );
        const hits = docs.flatMap((doc) => {
          const index = doc.text.search(definitions);
          if (index < 0) return [];
          const before = doc.text.slice(0, index);
          const lineNo = before.split('\n').length;
          const content = doc.text
            .split('\n')
            .slice(Math.max(0, lineNo - 3), lineNo + 5)
            .join('\n')
            .slice(0, 1000);
          return [`${doc.path?.split(/[\\/]/).pop() ?? 'Document'}:${lineNo}\n${content}`];
        });
        if (!hits.length) return null;
        return {
          pos: line.from + match.index!,
          end: line.from + match.index! + match[0].length,
          above: true,
          create: () => {
            const dom = window.document.createElement('div');
            dom.className = 'cm-writing-hover';
            const title = window.document.createElement('strong');
            title.textContent = key;
            dom.append(title);
            for (const hit of hits.slice(0, 4)) {
              const pre = window.document.createElement('pre');
              pre.textContent = hit;
              dom.append(pre);
            }
            return { dom };
          },
        };
      },
      { hoverTime: 500 },
    ),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        index = new ProseIndex(language);
        constructor(view: EditorView) {
          this.decorations = Decoration.set(
            this.index
              .update(view.state.doc)
              .ranges.map((r) =>
                Decoration.mark({ attributes: { spellcheck: 'false' } }).range(r.from, r.to),
              ),
            true,
          );
        }
        update(update: ViewUpdate) {
          if (!update.docChanged) return;
          let first = update.state.doc.lines,
            last = 1;
          update.changes.iterChangedRanges((_a, _b, from, to) => {
            first = Math.min(first, update.state.doc.lineAt(from).number);
            last = Math.max(last, update.state.doc.lineAt(to).number);
          });
          const changed = this.index.update(
            update.state.doc,
            first,
            last,
            update.state.doc.lines - update.startState.doc.lines,
          );
          this.decorations = this.decorations.map(update.changes).update({
            filterFrom: changed.from,
            filterTo: changed.to,
            filter: (from, to) => to <= changed.from || from > changed.to,
            add: changed.ranges.map((r) =>
              Decoration.mark({ attributes: { spellcheck: 'false' } }).range(r.from, r.to),
            ),
            sort: true,
          });
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ];
}
