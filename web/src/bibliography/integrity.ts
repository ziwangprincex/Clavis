import type { BibEntry, ReferenceOccurrence } from '../api/tauri';

export interface CitationIntegrity { missingKeys: string[]; unusedKeys: string[]; }
export function citationIntegrity(entries: readonly BibEntry[], occurrences: readonly ReferenceOccurrence[]): CitationIntegrity {
  const defined = new Set(entries.map(entry => entry.key));
  const used = new Set(occurrences.filter(item => item.namespace === 'citation' && item.role === 'usage').map(item => item.key));
  return { missingKeys: [...used].filter(key => !defined.has(key)).sort(), unusedKeys: entries.map(entry => entry.key).filter(key => !used.has(key)).sort() };
}
