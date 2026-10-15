import { snippet, startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { t } from '../i18n';
import type { Lang } from '../store';
import { complete } from './engine';
import { snippetToCM6 } from './snippets';
import type { CompletionCandidate, CompletionWorkspace } from './types';

/** CodeMirror adapter for the editor-agnostic completion module. */
export function buildCompletionSource(
  language: Lang,
  getWorkspace?: () => CompletionWorkspace | undefined,
  onJump?: (path: string | null, line: number) => void,
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
        info: candidate.info || (candidate.source && onJump) ? () => infoPanel(candidate, onJump) : undefined,
      })),
    };
  };
}

/** The panel beside the list: the candidate's description and, for a label or
 *  key defined in the project, a link to where it is defined (Texifier's "Jump to"). */
function infoPanel(candidate: CompletionCandidate, onJump?: (path: string | null, line: number) => void): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-completion-detail';
  if (candidate.info) {
    const text = document.createElement('div');
    text.className = 'cm-completion-detail-text';
    text.textContent = candidate.info;
    dom.append(text);
  }
  const source = candidate.source;
  if (source && onJump) {
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'cm-completion-detail-jump';
    const file = source.path?.replace(/^.*[\\/]/, '');
    jump.textContent = file ? t('Go to {file}:{line}', { file, line: source.line }) : t('Go to line {line}', { line: source.line });
    // Keep focus in the editor; the jump itself closes the list.
    jump.addEventListener('mousedown', event => event.preventDefault());
    jump.addEventListener('click', () => onJump(source.path, source.line));
    dom.append(jump);
  }
  return dom;
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
