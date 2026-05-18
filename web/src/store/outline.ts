// Document outline parsing — reads heading-like markers out of source text.
// Ported from ui-legacy/app.js parseOutline (lines 1440-1474), behaviour-equivalent.

import type { Lang } from './tabs';

export interface OutlineItem {
  level: number;
  title: string;
  /** 1-based line number */
  line: number;
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
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*```/.test(l) || /^\s*~~~/.test(l)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
      if (m) items.push({ level: m[1].length - 1, title: m[2].trim(), line: i + 1 });
    }
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
