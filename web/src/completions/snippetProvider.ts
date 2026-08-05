import { snippetsForLang } from './snippets';
import type { CompletionCandidate, CompletionProvider } from './types';

/** Sites whose argument is a known name rather than a snippet body. */
const NON_SNIPPET_SITES = new Set(['citation', 'reference', 'file', 'package', 'class', 'keyval']);

export const snippetProvider: CompletionProvider = {
  complete(request, site) {
    if (NON_SNIPPET_SITES.has(site.kind)) return [];

    return snippetsForLang(request.language)
      .filter(item => {
        if (site.kind === 'environment') {
          return site.action === 'begin' && item.l.startsWith('\\begin{');
        }
        if (site.kind === 'command') return item.l.startsWith('\\');
        return !item.l.startsWith('\\');
      })
      .map<CompletionCandidate>(item => ({
        label: item.l,
        insertText: item.t,
        detail: item.d,
        kind: 'snippet',
        snippet: true,
        boost: item.l.startsWith('\\') || item.l.startsWith('#') ? 1 : 0,
      }));
  },
};
