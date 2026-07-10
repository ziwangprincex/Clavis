// Clickable \input{...}/\include{...} links for the LaTeX editor.
//
// A ViewPlugin scans the visible document for include-style macros and marks
// their path argument with `.cm-input-link`. Ctrl/Cmd+click on a marked span
// invokes the `onOpenInclude` callback with the raw argument (the resolution to
// an absolute project path happens in the caller, via resolveIncludeTarget).
//
// Ctrl/Cmd is required so ordinary clicks still place the cursor normally.

import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

// Matches \input{...}, \include{...}, \subfile{...}, and the import-family
// \import{dir}{file} / \subimport{dir}{file}. Group 1 is the macro name, group 2
// the optional first {dir} brace (import family only), group 3 the final {path}.
// Mirrors the include set recognized by the backend's collect_project_files.
const INCLUDE_RE =
  /\\(input|include|subfile|subimport|import)\s*(?:\{([^}]*)\}\s*)?\{([^}]*)\}/g;

// The link mark carries the resolved raw path (dir+file joined) and whether the
// macro is import-family, so the click handler doesn't have to re-parse the DOM.
function linkMark(path: string, isImport: boolean) {
  return Decoration.mark({
    class: 'cm-input-link',
    attributes: { 'data-include': path, 'data-import': isImport ? '1' : '0' },
  });
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    INCLUDE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INCLUDE_RE.exec(text)) !== null) {
      const macro = m[1];
      const dir = m[2];
      const file = m[3];
      if (!file) continue;
      const isImport = macro === 'import' || macro === 'subimport';
      // Join dir+file for import-family so the resolver gets the full path.
      const fullPath = isImport && dir ? `${dir.replace(/\/?$/, '/')}${file}` : file;
      // Decorate the final {file} span (the visible filename the user clicks).
      const argOffsetInMatch = m[0].lastIndexOf(file);
      const start = from + m.index + argOffsetInMatch;
      const end = start + file.length;
      builder.add(start, end, linkMark(fullPath, isImport));
    }
  }
  return builder.finish();
}

/**
 * Build the clickable-include extension. `onOpen` receives the resolved raw path
 * (dir+file joined for import-family) and whether the macro is import-family;
 * the caller resolves and opens it.
 */
export function inputLinkExtension(onOpen: (raw: string, isImport: boolean) => void) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = buildDecorations(u.view);
        }
      }
    },
    {
      decorations: v => v.decorations,
      eventHandlers: {
        mousedown(event) {
          if (!(event.ctrlKey || event.metaKey)) return false;
          // Syntax highlighting can nest a token span inside the link mark, so
          // the click may land on a child — walk up to the marked element.
          const el = (event.target as HTMLElement).closest<HTMLElement>('.cm-input-link');
          if (!el) return false;
          const raw = el.getAttribute('data-include') ?? '';
          if (!raw) return false;
          const isImport = el.getAttribute('data-import') === '1';
          event.preventDefault();
          onOpen(raw.trim(), isImport);
          return true;
        },
      },
    },
  );

  const theme = EditorView.baseTheme({
    '.cm-input-link': {
      textDecoration: 'underline',
      textDecorationStyle: 'dotted',
      cursor: 'pointer',
    },
    '.cm-input-link:hover': {
      color: 'var(--accent)',
    },
  });

  return [plugin, theme];
}
