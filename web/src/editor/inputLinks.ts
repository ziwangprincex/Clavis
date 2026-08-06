// Ctrl/Cmd-click navigation for static LaTeX and Typst source-file references.
// Resolution happens above this view extension; it only marks source text.

import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Lang } from '../store';
import { latexWorkspaceEnvironments, latexWorkspaceMacros } from '../completions/latexMacroScan';
import type { CompletionWorkspace } from '../completions/types';

const LATEX_INCLUDE_RE = /\\(input|include|subfile|subimport|import)\s*(?:\{([^}]*)\}\s*)?\{([^}]*)\}/g;
const TYPST_FILE_RE = /#(?:import\s+|include\s*\()"([^"\r\n]+)"/g;

function linkMark(path: string, kind: 'latex' | 'typst' | 'latex-macro' | 'latex-environment', isImport = false) {
  return Decoration.mark({ class: 'cm-input-link', attributes: { 'data-include': path, 'data-kind': kind, 'data-import': isImport ? '1' : '0' } });
}

function buildDecorations(view: EditorView, language: Lang, workspace?: CompletionWorkspace): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    if (language === 'latex') {
      LATEX_INCLUDE_RE.lastIndex = 0; let match: RegExpExecArray | null;
      while ((match = LATEX_INCLUDE_RE.exec(text)) !== null) {
        const file = match[3]; if (!file) continue;
        const isImport = match[1] === 'import' || match[1] === 'subimport';
        const raw = isImport && match[2] ? `${match[2].replace(/\/?$/, '/')}${file}` : file;
        const start = from + match.index + match[0].lastIndexOf(file);
        builder.add(start, start + file.length, linkMark(raw, 'latex', isImport));
      }
      const macros = latexWorkspaceMacros(workspace, view.state.doc.toString());
      const command = /\\([A-Za-z@]+)/g;
      while ((match = command.exec(text)) !== null) {
        const name = match[1];
        if (!macros.has(name) || /^(?:newcommand|renewcommand|providecommand|NewDocumentCommand|RenewDocumentCommand|ProvideDocumentCommand)$/.test(name)) continue;
        const start = from + match.index;
        builder.add(start, start + match[0].length, linkMark(name, 'latex-macro'));
      }
      const environments = latexWorkspaceEnvironments(workspace, view.state.doc.toString());
      const environment = /\\(?:begin|end)\s*\{([A-Za-z][\w*@.-]*)\}/g;
      while ((match = environment.exec(text)) !== null) {
        const name = match[1]; if (!environments.has(name)) continue;
        const start = from + match.index + match[0].lastIndexOf(name);
        builder.add(start, start + name.length, linkMark(name, 'latex-environment'));
      }
    } else if (language === 'typst') {
      // Static quoted local .typ targets only. Comments/dynamic/package imports
      // are rejected by the resolver, and no link is generated for non-.typ text.
      TYPST_FILE_RE.lastIndex = 0; let match: RegExpExecArray | null;
      while ((match = TYPST_FILE_RE.exec(text)) !== null) {
        const raw = match[1];
        if (!raw.toLowerCase().endsWith('.typ')) continue;
        const start = from + match.index + match[0].lastIndexOf(raw);
        builder.add(start, start + raw.length, linkMark(raw, 'typst'));
      }
    }
  }
  return builder.finish();
}

export function inputLinkExtension(language: Lang, workspace: (() => CompletionWorkspace | undefined) | undefined, onOpen: (raw: string, kind: 'latex' | 'typst' | 'latex-macro' | 'latex-environment', isImport: boolean) => void) {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildDecorations(view, language, workspace?.()); }
    update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view, language, workspace?.()); }
  }, { decorations: value => value.decorations, eventHandlers: { mousedown(event) {
    if (!(event.ctrlKey || event.metaKey)) return false;
    const element = (event.target as HTMLElement).closest<HTMLElement>('.cm-input-link');
    const raw = element?.getAttribute('data-include') ?? '';
    const kind = element?.getAttribute('data-kind') as 'latex' | 'typst' | 'latex-macro' | 'latex-environment' | null;
    if (!element || !raw || !kind) return false;
    event.preventDefault(); onOpen(raw, kind, element.getAttribute('data-import') === '1'); return true;
  } } });
  return [plugin, EditorView.baseTheme({ '.cm-input-link': { textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }, '.cm-input-link:hover': { color: 'var(--accent)' } })];
}
