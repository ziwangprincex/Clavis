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
