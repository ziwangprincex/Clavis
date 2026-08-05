import { snippet, startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { Lang } from '../store';
import { complete } from './engine';
import { snippetToCM6 } from './snippets';
import type { CompletionCandidate, CompletionWorkspace } from './types';

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
        apply: buildApply(candidate),
        boost: candidate.boost,
      })),
    };
  };
}

/**
 * Build the `apply` callback for one candidate.
 *
 * Argument-only commands (`\usepackage`, `\documentclass`) apply a snippet that
 * drops the cursor into an empty argument, where the argument-site providers
 * (package / class) take over. CodeMirror normally re-runs the completion
 * source after an `input.complete` transaction, but relying on that timing left
 * users staring at an empty popup after accepting the command — so for those
 * candidates we explicitly re-open completion at the new cursor position.
 */
function buildApply(candidate: CompletionCandidate): Completion['apply'] {
  const insert = candidate.snippet
    // cwl-derived templates are already CM6 syntax; running them through the
    // legacy converter would mangle argument names containing spaces.
    ? snippet(candidate.snippetSyntax === 'cm6'
      ? candidate.insertText
      : snippetToCM6(candidate.insertText))
    : candidate.insertText;
  if (typeof insert === 'string') return insert;
  if (!candidate.reopenCompletion) return insert;
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    insert(view, completion, from, to);
    // Snippet apply is synchronous; the new cursor sits inside the braces.
    startCompletion(view);
  };
}

export type { CompletionDocument, CompletionWorkspace } from './types';
