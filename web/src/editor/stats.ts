// Pure document-stats helpers used by the status bar.
//
// Kept in `editor/` next to the controller because the numbers they report
// (words, characters, lines) mirror what an editor status bar traditionally
// shows. Kept string-only so tests can run in the node vitest environment.

/** Character count as reported to the user (JS string length; a surrogate pair
 *  counts as 2, which matches VS Code's status bar behavior). */
export function countChars(s: string): number {
  return s.length;
}

/** Line count = number of `\n` plus one, floored at 1 for empty documents. */
export function countLines(s: string): number {
  if (s.length === 0) return 1;
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

// Words are whitespace-separated runs. Chosen to match VS Code / common editor
// conventions rather than word-boundary regex, which double-counts contractions
// and hyphenated words on some Unicode edges.
const WORD_SPLIT = /\s+/;

export function countWords(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(WORD_SPLIT).length;
}

export interface DocStats {
  words: number;
  chars: number;
  lines: number;
}

export function computeStats(s: string): DocStats {
  return { words: countWords(s), chars: countChars(s), lines: countLines(s) };
}
