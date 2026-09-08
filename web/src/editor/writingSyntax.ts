import type { Lang } from '../store/tabs';
export interface TextRange { from: number; to: number }
export interface MathRange extends TextRange { content: string; display: boolean }
const blank = (text: string) => text.replace(/[^\n\r]/g, ' ');

/** Preserve offsets while removing syntax that is not prose. Conservative for code. */
export function proseMask(text: string, lang: Lang): string {
  let masked = text;
  const hide = (re: RegExp) => { masked = masked.replace(re, blank); };
  if (lang === 'latex') {
    hide(/\\begin\{(verbatim\*?|lstlisting|minted|thebibliography|equation\*?|align\*?|gather\*?|multline\*?)\}[\s\S]*?\\end\{\1\}/g);
    hide(/\\verb\*?([^\w\s])[^\n]*?\1/g);
    masked = masked.split('\n').map(line => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== '%') continue;
        let n = 0; for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) n++;
        if (n % 2 === 0) return line.slice(0, i) + blank(line.slice(i));
      }
      return line;
    }).join('\n');
    hide(/\\(?:begin|end|label|(?:eq|page|auto|c|C)?ref|cite\w*|input|include|includegraphics|usepackage|documentclass|bibliography|addbibresource|url)\*?(?:\[[^\]]*\])*\{[^}]*\}/g);
    hide(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g);
    hide(/\\[A-Za-z@]+\*?(?:\[[^\]]*\])?/g);
  } else {
    if (lang === 'typst') {
      hide(/\/\*[\s\S]*?\*\//g);
      hide(/"(?:\\.|[^"\\])*"/g);
      hide(/\/\/[^\n]*/g);
      hide(/#(?:let|set|show|import|include)\b[^\n]*/g);
      hide(/#[A-Za-z][\w.-]*(?:\([^\n]*?\))?/g);
      hide(/<[^<>\s]+>|@[\w:.-]+/g);
    }
    hide(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g);
    hide(/`[^`\n]*`/g);
    if (lang === 'markdown') hide(/\]\([^)]*\)/g);
  }
  hide(/(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$[^$]*?(?<!\\)\$/g);
  return masked;
}
export function nonProseRanges(text: string, lang: Lang): TextRange[] {
  const mask = proseMask(text, lang);
  const ranges: TextRange[] = [];
  let start = -1;
  for (let i = 0; i <= text.length; i++) {
    const hidden = i < text.length && mask[i] !== text[i];
    if (hidden && start < 0) start = i;
    else if (!hidden && start >= 0) { ranges.push({ from: start, to: i }); start = -1; }
  }
  return ranges;
}
export function mathAt(text: string, pos: number, lang: Lang): MathRange | null {
  if (lang === 'markdown' || lang === 'latex' || lang === 'typst') {
    const masked = (lang === 'typst' ? text.replace(/"(?:\\.|[^"\\])*"/g, blank) : text).replace(/`[^`]*`/g, blank)
      .replace(lang === 'latex' ? /(?<!\\)%[^\n]*/g : /\/\/[^\n]*|\/\*[\s\S]*?\*\//g, blank);
    const re = /(?<!\\)\$\$([\s\S]*?)(?<!\\)\$\$|(?<!\\)\$([^$]*?)(?<!\\)\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g;
    for (const match of masked.matchAll(re)) {
      if (match.index! > pos) break;
      if (pos >= match.index! && pos < match.index! + match[0].length) return { from: match.index!, to: match.index! + match[0].length, content: match[1] ?? match[2] ?? match[3] ?? match[4], display: match[1] !== undefined || match[3] !== undefined };
    }
  }
  return null;
}

export function foldRange(text: string, lineStart: number, lang: Lang): TextRange | null {
  const lines = text.split('\n');
  let offset = 0; let index = 0;
  while (index < lines.length && offset < lineStart) { offset += lines[index].length + 1; index++; }
  if (index >= lines.length) return null;
  const line = lines[index];
  const heading = (s: string): number => {
    if (lang === 'latex') {
      const m = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?[{[]/.exec(s);
      return m ? ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph'].indexOf(m[1]) + 1 : 0;
    }
    const m = (lang === 'typst' ? /^\s*(=+)\s/ : /^\s*(#+)\s/).exec(s);
    return m?.[1].length ?? 0;
  };
  const level = heading(line);
  let end = offset + line.length;
  if (level) {
    for (let i = index + 1; i < lines.length; i++) {
      const next = heading(lines[i]);
      if (next && next <= level) break;
      end += lines[i].length + 1;
    }
  } else if (lang === 'latex') {
    const begin = /^\s*\\begin\{([^}]+)\}/.exec(line);
    if (!begin) return null;
    const escaped = begin[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokens = new RegExp(`\\\\(begin|end)\\{${escaped}\\}`, 'g');
    let depth = 0;
    for (const token of text.slice(offset).matchAll(tokens)) {
      depth += token[1] === 'begin' ? 1 : -1;
      if (!depth) { end = offset + token.index!; break; }
    }
  }
  const from = offset + line.length;
  return end > from + 1 ? { from, to: end } : null;
}
