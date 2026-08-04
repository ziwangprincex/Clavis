import type { Lang } from '../store';

export interface CompletionDocument {
  path: string | null;
  language: Lang;
  text: string;
}

export interface CompletionWorkspace {
  rootPath: string | null;
  activePath: string | null;
  documents: readonly CompletionDocument[];
}

export interface CompletionRequest {
  language: Lang;
  text: string;
  position: number;
  explicit: boolean;
  workspace?: CompletionWorkspace;
}

export type CompletionSite =
  | { kind: 'command'; from: number; to: number; query: string }
  | { kind: 'environment'; from: number; to: number; query: string; action: 'begin' | 'end' }
  | { kind: 'citation'; from: number; to: number; query: string }
  | { kind: 'reference'; from: number; to: number; query: string }
  | { kind: 'file'; from: number; to: number; query: string; command: string }
  | { kind: 'word'; from: number; to: number; query: string };

export interface CompletionCandidate {
  label: string;
  insertText: string;
  detail?: string;
  kind?: 'command' | 'environment' | 'reference' | 'citation' | 'file' | 'snippet';
  snippet?: boolean;
  /**
   * Placeholder dialect of `insertText` when `snippet` is set.
   *
   * `'legacy'` (the default) is the hand-written `$1default` form used by
   * `snippets.ts`, converted by `snippetToCM6` at insertion time. That form is
   * lossy — single-digit field numbers, and defaults restricted to
   * `[A-Za-z0-9_\-.]` — so it cannot carry cwl argument names like
   * `short title` or `bib file`. Providers with such names emit `'cm6'`
   * (`${1:short title}`) and bypass the converter.
   */
  snippetSyntax?: 'legacy' | 'cm6';
  boost?: number;
}

export interface CompletionResponse {
  from: number;
  to: number;
  candidates: readonly CompletionCandidate[];
}

export interface CompletionProvider {
  complete(
    request: CompletionRequest,
    site: CompletionSite,
  ): readonly CompletionCandidate[] | Promise<readonly CompletionCandidate[]>;
}
