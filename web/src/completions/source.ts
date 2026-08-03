import { snippet, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { Lang } from '../store';
import { complete } from './engine';
import { snippetToCM6 } from './snippets';
import type { CompletionWorkspace } from './types';

/** CodeMirror adapter for the editor-agnostic completion module. */
export function buildCompletionSource(
  language: Lang,
  getWorkspace?: () => CompletionWorkspace | undefined,
) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const response = await complete({
      language,
      text: context.state.doc.toString(),
      position: context.pos,
      explicit: context.explicit,
      workspace: getWorkspace?.(),
    });
    if (!response || context.aborted) return null;

    return {
      from: response.from,
      to: response.to,
      options: response.candidates.map(candidate => ({
        label: candidate.label,
        detail: candidate.detail,
        type: candidate.kind ?? 'text',
        apply: candidate.snippet ? snippet(snippetToCM6(candidate.insertText)) : candidate.insertText,
        boost: candidate.boost,
      })),
    };
  };
}

export type { CompletionDocument, CompletionWorkspace } from './types';
