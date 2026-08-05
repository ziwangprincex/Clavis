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


export interface ResearchStats {
  /** Estimated prose words after language-specific markup/math/code stripping. */
  mainWords: number;
  /** Estimated abstract words when a recognizable Abstract section exists. */
  abstractWords: number | null;
}

const PROSE_WORD = /[\p{L}\p{N}]+(?:[?'\-][\p{L}\p{N}]+)*/gu;

function proseWords(text: string): number {
  return text.match(PROSE_WORD)?.length ?? 0;
}

function stripMarkdown(text: string): string {
  let out = text.replace(/^---\s*[\s\S]*?^---\s*$/m, ' ');
  out = out.replace(/^\s*(```+|~~~+).*?^\s*(?:```+|~~~+)\s*$/ms, ' ');
  out = out.replace(/`+[^\n]*?`+/g, ' ');
  out = out.replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/(?<!\\)\$[^\n$]+(?<!\\)\$/g, ' ');
  out = out.replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1');
  return out.replace(/[>#*_`]/g, ' ');
}

function stripLatex(text: string): string {
  let out = text.split(/\r?\n/).map(line => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '%') continue;
      let slashes = 0;
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) slashes++;
      if (slashes % 2 === 0) return line.slice(0, i);
    }
    return line;
  }).join('\n');
  out = out.replace(/\\begin\{(?:equation\*?|align\*?|gather\*?|math|displaymath|verbatim\*?|lstlisting|minted|thebibliography)\}[\s\S]*?\\end\{(?:equation\*?|align\*?|gather\*?|math|displaymath|verbatim\*?|lstlisting|minted|thebibliography)\}/g, ' ');
  out = out.replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/(?<!\\)\$[^\n$]+(?<!\\)\$/g, ' ');
  out = out.replace(/\\(?:cite\w*|ref|eqref|pageref|autoref|cref|Cref|label)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{[^{}]*\}/g, ' ');
  out = out.replace(/\\[A-Za-z@]+\*?(?:\s*\[[^\]]*\])?/g, ' ');
  return out.replace(/[{}]/g, ' ');
}

function stripTypst(text: string): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  out = out.replace(/`+[^\n]*?`+/g, ' ');
  out = out.replace(/\$\$?[\s\S]*?\$\$?/g, ' ');
  // Remove common inline code calls conservatively; visible bracket content
  // remains prose in Typst and should still be counted.
  out = out.replace(/#[A-Za-z_][\w.-]*\s*\([^)]*\)/g, ' ');
  out = out.replace(/#[A-Za-z_][\w.-]*/g, ' ');
  return out.replace(/[<>{}\[\]]/g, ' ');
}

function abstractFromMarkdown(text: string): string | null {
  const match = /^#{1,6}\s+abstract\s*$\n([\s\S]*?)(?=^#{1,6}\s+|(?![\s\S]))/im.exec(text);
  return match?.[1] ?? null;
}

function abstractFromLatex(text: string): string | null {
  return /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/i.exec(text)?.[1] ?? null;
}

function abstractFromTypst(text: string): string | null {
  return /^=\s+abstract\s*$\n([\s\S]*?)(?=^=\s+|(?![\s\S]))/im.exec(text)?.[1] ?? null;
}

function withoutAbstract(text: string, language: 'markdown' | 'latex' | 'typst'): string {
  if (language === 'latex') return text.replace(/\begin\{abstract\}[\s\S]*?\end\{abstract\}/i, ' ');
  if (language === 'typst') return text.replace(/^=\s+abstract\s*$\n[\s\S]*?(?=^=\s+|$)/im, ' ');
  return text.replace(/^#{1,6}\s+abstract\s*$\n[\s\S]*?(?=^#{1,6}\s+|$)/im, ' ');
}

export function computeResearchStats(text: string, language: 'markdown' | 'latex' | 'typst'): ResearchStats {
  const strip = language === 'latex' ? stripLatex : language === 'typst' ? stripTypst : stripMarkdown;
  const abstract = language === 'latex' ? abstractFromLatex(text) : language === 'typst' ? abstractFromTypst(text) : abstractFromMarkdown(text);
  return {
    mainWords: proseWords(strip(withoutAbstract(text, language))),
    abstractWords: abstract == null ? null : proseWords(strip(abstract)),
  };
}
