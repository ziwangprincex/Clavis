import type { Tab } from '../store/tabs';
import { normalizePath } from './projectPaths';
import { detectDocumentLanguage, documentTitle } from './documentIdentity';

export const SESSION_VERSION = 2;
export const MAX_RESTORED_TABS = 50;
const SUPPORTED_SESSION_VERSIONS = new Set([1, SESSION_VERSION]);

export interface PersistedTab {
  title: string;
  filePath: string | null;
  lang: Tab['lang'];
  content: string;
  isDirty: boolean;
}

interface PersistedSession {
  version: number;
  activeIndex: number;
  tabs: PersistedTab[];
}

export interface RestoredSession {
  activeIndex: number;
  tabs: PersistedTab[];
}

interface Candidate {
  tab: PersistedTab;
  sourceIndexes: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLanguage(value: unknown): value is Tab['lang'] {
  return value === 'markdown' || value === 'latex' || value === 'typst';
}

function readTab(value: unknown): PersistedTab | null {
  if (!isRecord(value)) return null;
  const { title, filePath, lang, content, isDirty } = value;
  if (
    typeof title !== 'string'
    || (filePath !== null && typeof filePath !== 'string')
    || !isLanguage(lang)
    || typeof content !== 'string'
    || typeof isDirty !== 'boolean'
  ) {
    return null;
  }
  if (filePath !== null && filePath.trim() === '') return null;

  if (filePath) {
    return {
      title: documentTitle(filePath),
      filePath,
      lang: detectDocumentLanguage(filePath),
      content,
      isDirty,
    };
  }
  return { title, filePath: null, lang, content, isDirty };
}

function deduplicateTabs(values: unknown[]): Candidate[] {
  const candidates: Candidate[] = [];
  const fileSlots = new Map<string, number>();

  values.forEach((value, sourceIndex) => {
    const tab = readTab(value);
    if (!tab) return;
    if (!tab.filePath) {
      candidates.push({ tab, sourceIndexes: [sourceIndex] });
      return;
    }

    const key = normalizePath(tab.filePath);
    const existingSlot = fileSlots.get(key);
    if (existingSlot === undefined) {
      fileSlots.set(key, candidates.length);
      candidates.push({ tab, sourceIndexes: [sourceIndex] });
      return;
    }

    const existing = candidates[existingSlot];
    candidates[existingSlot] = {
      tab,
      sourceIndexes: [...existing.sourceIndexes, sourceIndex],
    };
  });

  return candidates;
}

function capCandidates(candidates: Candidate[], activeCandidate: number): Candidate[] {
  if (candidates.length <= MAX_RESTORED_TABS) return candidates;

  const selected = new Set<number>();
  if (activeCandidate >= 0) selected.add(activeCandidate);

  for (let index = candidates.length - 1; index >= 0 && selected.size < MAX_RESTORED_TABS; index--) {
    if (candidates[index].tab.isDirty) selected.add(index);
  }
  for (let index = candidates.length - 1; index >= 0 && selected.size < MAX_RESTORED_TABS; index--) {
    selected.add(index);
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map(index => candidates[index]);
}

/**
 * Decode, validate, migrate, deduplicate, and cap a Session Snapshot.
 * A damaged Document is skipped; damage only rejects the whole snapshot when
 * no recoverable Documents remain.
 */
export function decodeSessionSnapshot(raw: string): RestoredSession | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const { version, activeIndex, tabs } = value;
  if (
    typeof version !== 'number'
    || !SUPPORTED_SESSION_VERSIONS.has(version)
    || !Array.isArray(tabs)
    || tabs.length === 0
  ) {
    return null;
  }

  const sourceActiveIndex = Number.isInteger(activeIndex) && Number(activeIndex) >= 0
    ? Number(activeIndex)
    : 0;
  const candidates = deduplicateTabs(tabs);
  if (candidates.length === 0) return null;

  let activeCandidate = candidates.findIndex(candidate =>
    candidate.sourceIndexes.includes(sourceActiveIndex),
  );
  if (activeCandidate < 0) activeCandidate = 0;

  const capped = capCandidates(candidates, activeCandidate);
  const activeSourceIndexes = candidates[activeCandidate].sourceIndexes;
  let restoredActiveIndex = capped.findIndex(candidate =>
    candidate.sourceIndexes.some(index => activeSourceIndexes.includes(index)),
  );
  if (restoredActiveIndex < 0) restoredActiveIndex = 0;

  return {
    activeIndex: restoredActiveIndex,
    tabs: capped.map(candidate => candidate.tab),
  };
}

/** Encode the persistent portion of a Workspace as the current Session Snapshot. */
export function encodeSessionSnapshot(tabs: Tab[], activeTabId: string | null): string {
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === activeTabId));
  const snapshot: PersistedSession = {
    version: SESSION_VERSION,
    activeIndex,
    tabs: tabs.map(tab => ({
      title: tab.title,
      filePath: tab.filePath,
      lang: tab.lang,
      content: tab.content,
      isDirty: tab.isDirty,
    })),
  };
  return JSON.stringify(snapshot);
}
