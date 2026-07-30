import type { Lang } from '../store/tabs';

/** The canonical language implied by a file-backed Document's path. */
export function detectDocumentLanguage(path: string): Lang {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tex') || lower.endsWith('.ltx')) return 'latex';
  if (lower.endsWith('.typ')) return 'typst';
  return 'markdown';
}

/** The canonical display title for a file-backed Document. */
export function documentTitle(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
