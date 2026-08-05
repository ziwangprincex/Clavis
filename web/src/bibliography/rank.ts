import type { BibEntry } from '../api/tauri';

export interface IndexedBibEntry {
  entry: BibEntry;
  key: string;
  authorYear: string;
  titleVenue: string;
  secondary: string;
}

export interface RankedBibEntry {
  entry: BibEntry;
  score: number;
  usageCount: number;
  recentRank: number;
}

function normalized(value: string | undefined): string {
  return (value ?? '').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function indexBibliography(entries: readonly BibEntry[]): IndexedBibEntry[] {
  return entries.map(entry => ({
    entry,
    key: normalized(entry.key),
    authorYear: normalized(`${entry.author ?? ''} ${entry.editor ?? ''} ${entry.year ?? ''}`),
    titleVenue: normalized(`${entry.title ?? ''} ${entry.journal ?? ''} ${entry.booktitle ?? ''} ${entry.publisher ?? ''}`),
    secondary: normalized(`${entry.doi ?? ''} ${(entry.keywords ?? []).join(' ')} ${entry.abstractText ?? ''} ${entry.entryType}`),
  }));
}

function fieldScore(token: string, item: IndexedBibEntry): number {
  if (item.key === token) return 160;
  if (item.key.startsWith(token)) return 120;
  if (item.key.includes(token)) return 90;
  if (item.authorYear.split(/\s+/).some(word => word.startsWith(token))) return 70;
  if (item.authorYear.includes(token)) return 60;
  if (item.titleVenue.split(/\s+/).some(word => word.startsWith(token))) return 45;
  if (item.titleVenue.includes(token)) return 35;
  if (item.secondary.includes(token)) return 20;
  return 0;
}

export function rankBibliography(
  indexed: readonly IndexedBibEntry[],
  query: string,
  usageCounts: ReadonlyMap<string, number>,
  recentKeys: readonly string[],
): RankedBibEntry[] {
  const tokens = normalized(query).trim().split(/\s+/).filter(Boolean);
  const recent = new Map(recentKeys.map((key, index) => [key, index]));
  const ranked: RankedBibEntry[] = [];

  for (const item of indexed) {
    let score = 0;
    let matched = true;
    for (const token of tokens) {
      const next = fieldScore(token, item);
      if (next === 0) { matched = false; break; }
      score += next;
    }
    if (!matched) continue;
    const usageCount = usageCounts.get(item.entry.key) ?? 0;
    const recentRank = recent.get(item.entry.key) ?? Number.MAX_SAFE_INTEGER;
    if (tokens.length > 0) {
      score += Math.min(usageCount, 20) * 2;
      if (recentRank !== Number.MAX_SAFE_INTEGER) score += Math.max(1, 20 - recentRank);
    }
    ranked.push({ entry: item.entry, score, usageCount, recentRank });
  }

  return ranked.sort((a, b) => {
    if (tokens.length > 0) return b.score - a.score || b.usageCount - a.usageCount || a.entry.key.localeCompare(b.entry.key);
    return a.recentRank - b.recentRank
      || b.usageCount - a.usageCount
      || Number(b.entry.year?.slice(0, 4) ?? 0) - Number(a.entry.year?.slice(0, 4) ?? 0)
      || a.entry.key.localeCompare(b.entry.key);
  });
}
