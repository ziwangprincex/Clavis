import { ipc, type BibEntry } from '../api/tauri';
import type { CompletionDocument } from '../completions/types';
import { pathsEqual } from '../files/projectPaths';

export function bibliographyDocuments(documents: readonly CompletionDocument[]) {
  return documents.flatMap(doc => doc.path && /\.bib$/i.test(doc.path)
    ? [{ path: doc.path, content: doc.text }] : []);
}

type BibDocuments = ReturnType<typeof bibliographyDocuments>;

export function sameBibliography(a: BibDocuments, b: BibDocuments): boolean {
  return a.length === b.length && a.every((doc, i) =>
    pathsEqual(doc.path, b[i].path) && doc.content === b[i].content);
}

/** One snapshot per editor: reuse Rust's parser, including unsaved .bib edits. */
export function createBibLookup() {
  let snapshot: BibDocuments | null = null;
  let pending: Promise<BibEntry[]> = Promise.resolve([]);
  return async (documents: BibDocuments, key: string): Promise<BibEntry | null> => {
    if (!snapshot || !sameBibliography(snapshot, documents)) {
      snapshot = documents;
      pending = documents.length ? ipc.parseBib([], documents) : Promise.resolve([]);
    }
    const result = pending;
    try {
      return (await result).find(entry => entry.key === key) ?? null;
    } catch (error) {
      // A failed request may be retried; it must not become a cached missing key.
      if (pending === result) snapshot = null;
      throw error;
    }
  };
}
