import { snippetsForLang } from './snippets';
import type { CompletionCandidate, CompletionProvider } from './types';

export const snippetProvider: CompletionProvider = {
  complete(request, site) {
    if (site.kind === 'citation' || site.kind === 'reference' || site.kind === 'file') return [];

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
