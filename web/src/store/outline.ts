import { markdownHeadings } from '../render/markdown';
// Document outline parsing — reads heading-like markers out of source text.
// Ported from ui-legacy/app.js parseOutline (lines 1440-1474), behaviour-equivalent.

import type { Lang } from './tabs';
import type { ProjectFile } from './project';
import { pathsEqual } from '../files/projectPaths';

export interface OutlineItem {
  level: number;
  title: string;
  /** 1-based line number */
  line: number;
  /** Absolute path of the file this heading lives in. Set only for merged
   *  multi-file project outlines; undefined for a single active file. */
  sourceFileAbsPath?: string;
}

const LATEX_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

export function parseOutline(src: string, lang: Lang): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = src.split('\n');

  if (lang === 'markdown') {
    return markdownHeadings(src).map(({ level, title, line }) => ({ level, title, line }));
  } else if (lang === 'latex') {
    const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]*)\}/g;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*%/.test(l)) continue;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(l))) {
        items.push({
          level: LATEX_LEVELS[m[1]] ?? 2,
          title: m[2].trim(),
          line: i + 1,
        });
      }
    }
  } else if (lang === 'typst') {
    for (let i = 0; i < lines.length; i++) {
      const m = /^(=+)\s+(.+?)\s*$/.exec(lines[i]);
      if (m) items.push({ level: m[1].length - 1, title: m[2].trim(), line: i + 1 });
    }
  }

  return items;
}

/**
 * Merge outlines across all text files of a multi-file LaTeX project. Each
 * heading is tagged with its source file's absolute path so the UI can open
 * that file when the item is clicked.
 *
 * `files` should be in project include order (root first) — this is the BFS
 * order returned by the backend's `collect_project_files`. NOTE: this is
 * *file* order, not true reading order; a chapter `\input` in the middle of
 * main.tex still lists main.tex's own headings before any chapter's. Tracking
 * exact include positions is a future refinement (see the multi-file plan).
 *
 * `activeAbs`/`activeContent` supply the *live* editor content for the file
 * currently being edited: the collected `files` snapshot is captured when the
 * project is scanned and goes stale as the user types, so we substitute the
 * live buffer for the matching file. Path comparison is normalization-aware
 * (Windows `\\?\` vs plain paths).
 */
export function parseProjectOutline(
  files: ProjectFile[],
  activeAbs?: string | null,
  activeContent?: string,
): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (const f of files) {
    // Skip bibliographies and binary assets (images/fonts have empty content).
    if (f.isBib) continue;
    if (f.binaryBase64) continue;
    const isActive = activeAbs != null && pathsEqual(f.absPath, activeAbs);
    const text = isActive ? (activeContent ?? f.content) : f.content;
    if (!text) continue;
    for (const item of parseOutline(text, 'latex')) {
      items.push({ ...item, sourceFileAbsPath: f.absPath });
    }
  }
  return items;
}

// ---- Texifier's outline lists: figures and tables by caption, labels, cited keys ----

export type OutlineListKind = 'figures' | 'tables' | 'labels' | 'citations';
export type OutlineLists = Record<OutlineListKind, OutlineItem[]>;

const CITE = /\\(?:cite|citep|citet|citealp|citeauthor|citeyear|parencite|textcite|autocite|footcite|smartcite|supercite|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)\}/g;

/** The `{…}` argument starting at `open`, braces balanced. */
function braced(text: string, open: number): string | null {
  if (text[open] !== '{') return null;
  for (let i = open + 1, depth = 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

/** A caption as reading text: commands and braces dropped, spacing collapsed. */
function plainCaption(caption: string): string {
  return caption.replace(/\\[a-zA-Z@]+\*?/g, ' ').replace(/[{}~]/g, ' ').replace(/\s+/g, ' ').trim();
}

function latexLists(src: string, source: string | undefined, cited: Set<string>, lists: OutlineLists) {
  let float: { kind: 'figures' | 'tables'; line: number; caption: string } | null = null;
  src.split('\n').forEach((raw, index) => {
    const text = raw.replace(/(?<!\\)%.*$/, '');
    const line = index + 1;
    const begin = /\\begin\{(figure|table)\*?\}/.exec(text);
    if (begin) float = { kind: begin[1] === 'figure' ? 'figures' : 'tables', line, caption: '' };
    if (float && !float.caption) {
      const at = /\\caption\s*(?:\[[^\]]*\])?\s*(?=\{)/.exec(text);
      const caption = at ? braced(text, at.index + at[0].length) : null;
      if (caption !== null) float.caption = plainCaption(caption);
    }
    if (float && /\\end\{(figure|table)\*?\}/.test(text)) {
      lists[float.kind].push({ level: 0, title: float.caption, line: float.line, sourceFileAbsPath: source });
      float = null;
    }
    for (const match of text.matchAll(/\\label\{([^}]+)\}/g)) {
      lists.labels.push({ level: 0, title: match[1].trim(), line, sourceFileAbsPath: source });
    }
    for (const match of text.matchAll(CITE)) {
      for (const key of match[1].split(',').map(part => part.trim()).filter(Boolean)) {
        if (cited.has(key)) continue;
        cited.add(key);
        lists.citations.push({ level: 0, title: key, line, sourceFileAbsPath: source });
      }
    }
  });
}

/** Figures, tables, labels and citations of one LaTeX document, or of a whole
 *  project when `files` is given (the active file read from its live buffer). */
export function parseLatexLists(content: string, files?: ProjectFile[], activeAbs?: string | null): OutlineLists {
  const lists: OutlineLists = { figures: [], tables: [], labels: [], citations: [] };
  const cited = new Set<string>();
  if (!files) {
    latexLists(content, undefined, cited, lists);
    return lists;
  }
  for (const f of files) {
    if (f.isBib || f.binaryBase64) continue;
    const text = activeAbs != null && pathsEqual(f.absPath, activeAbs) ? content : f.content;
    if (text) latexLists(text, f.absPath, cited, lists);
  }
  return lists;
}
