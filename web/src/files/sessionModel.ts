import type { Tab } from '../store/tabs';
import { normalizePath } from './projectPaths';
import { detectDocumentLanguage, documentTitle } from './documentIdentity';

export const SESSION_VERSION = 2;
const SUPPORTED_SESSION_VERSIONS = new Set([1, SESSION_VERSION]);

export interface PersistedTab {
  title: string;
  filePath: string | null;
  lang: Tab['lang'];
  content: string;
  isDirty: boolean;
  diskRevision?: string;
  projectRoot?: string | null;
  latexEngineOverride?: string;
}

interface PersistedSession {
  version: number;
  activeIndex: number;
  folderPath: string | null;
  tabs: PersistedTab[];
}

export interface RestoredSession {
  activeIndex: number;
  folderPath: string | null;
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
      ...(typeof value.diskRevision === "string" && /^(?:missing|sha256:[a-f0-9]{64})$/.test(value.diskRevision) ? { diskRevision: value.diskRevision } : {}),
      ...(typeof value.projectRoot === 'string' && /^(?:\/|[a-z]:[\\/])/i.test(value.projectRoot) ? { projectRoot: value.projectRoot } : {}),
      ...(typeof value.latexEngineOverride === 'string' && ['pdflatex', 'xelatex', 'lualatex'].includes(value.latexEngineOverride) ? { latexEngineOverride: value.latexEngineOverride } : {}),
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

/**
 * Decode, validate, migrate, and deduplicate a Session Snapshot.
 * Never cap recovery: even a clean scratch tab has no other on-disk copy.
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
  ) {
    return null;
  }

  const sourceActiveIndex = Number.isInteger(activeIndex) && Number(activeIndex) >= 0
    ? Number(activeIndex)
    : 0;
  const candidates = deduplicateTabs(tabs);
  const folderPath = typeof value.folderPath === 'string'
    && /^(?:\/|[a-z]:\/)/i.test(normalizePath(value.folderPath))
    && !value.folderPath.includes('\0') ? value.folderPath : null;
  if (candidates.length === 0 && !folderPath) return null;

  let activeCandidate = candidates.findIndex(candidate =>
    candidate.sourceIndexes.includes(sourceActiveIndex),
  );
  if (activeCandidate < 0) activeCandidate = 0;

  return {
    activeIndex: activeCandidate,
    folderPath,
    tabs: candidates.map(candidate => candidate.tab),
  };
}

/** Encode the persistent portion of a Workspace as the current Session Snapshot. */
export function encodeSessionSnapshot(tabs: Tab[], activeTabId: string | null, folderPath: string | null = null): string {
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === activeTabId));
  const snapshot: PersistedSession = {
    version: SESSION_VERSION,
    folderPath,
    activeIndex,
    tabs: tabs.map(tab => ({
      title: tab.title,
      filePath: tab.filePath,
      lang: tab.lang,
      content: tab.content,
      isDirty: tab.isDirty,
      ...(tab.filePath && tab.diskRevision ? { diskRevision: tab.diskRevision } : {}),
      ...(tab.projectRoot ? { projectRoot: tab.projectRoot } : {}),
      ...(tab.latexEngineOverride ? { latexEngineOverride: tab.latexEngineOverride } : {}),
    })),
  };
  return JSON.stringify(snapshot);
}
