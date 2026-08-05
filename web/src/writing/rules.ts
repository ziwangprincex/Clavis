import type { Lang, Tab } from '../store/tabs';

export interface WritingOptions {
  spelling?: 'us' | 'uk' | 'mixed';
  ignoredAcronyms?: readonly string[];
}

export interface WritingDiagnostic {
  code: 'percent-space' | 'p-value-style' | 'figure-style' | 'table-style' | 'spelling-variant' | 'undefined-acronym';
  severity: 'warning' | 'info';
  message: string;
  path: string | null;
  line: number;
  column: number;
}

const ACRONYM_IGNORE = new Set(['API', 'CSV', 'DOI', 'HTML', 'JSON', 'PDF', 'PNG', 'TSV', 'URL', 'USA', 'UTF']);
const VARIANT_PAIRS: ReadonlyArray<[string, string]> = [
  ['color', 'colour'], ['behavior', 'behaviour'], ['labor', 'labour'], ['modeling', 'modelling'], ['organization', 'organisation'], ['analyze', 'analyse'],
];

function maskedLines(text: string, language: Lang): string[] {
  let out = text;
  if (language === 'latex') {
    out = out.split(/\r?\n/).map(line => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== '%') continue;
        let slashes = 0;
        for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) slashes++;
        if (slashes % 2 === 0) return line.slice(0, i);
      }
      return line;
    }).join('\n');
    out = out.replace(/\\begin\{(?:verbatim\*?|lstlisting|minted|thebibliography)\}[\s\S]*?\\end\{(?:verbatim\*?|lstlisting|minted|thebibliography)\}/g, match => match.replace(/[^\n]/g, ' '));
  } else if (language === 'typst') {
    out = out.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
    out = out.replace(/`+[^\n]*?`+/g, match => ' '.repeat(match.length));
  } else {
    out = out.replace(/^\s*(```+|~~~+).*?^\s*(?:```+|~~~+)\s*$/gms, match => match.replace(/[^\n]/g, ' '));
    out = out.replace(/`+[^\n]*?`+/g, match => ' '.repeat(match.length));
  }
  return out.split(/\r?\n/);
}

function addMatch(out: WritingDiagnostic[], code: WritingDiagnostic['code'], message: string, path: string | null, line: number, text: string, re: RegExp, severity: WritingDiagnostic['severity'] = 'warning') {
  for (const match of text.matchAll(re)) {
    out.push({ code, severity, message, path, line, column: (match.index ?? 0) + 1 });
  }
}

function lineDefinitions(line: string): Map<string, number> {
  const definitions = new Map<string, number>();
  for (const parenthetical of line.matchAll(/\(([^)]*)\)/g)) {
    const base = parenthetical.index ?? 0;
    for (const acronym of parenthetical[1].matchAll(/\b([A-Z]{2,8})\b/g)) {
      definitions.set(acronym[1], base + 1 + (acronym.index ?? 0));
    }
  }
  return definitions;
}

export function analyzeWriting(text: string, language: Lang, path: string | null, options: WritingOptions = {}): WritingDiagnostic[] {
  const lines = maskedLines(text, language);
  const out: WritingDiagnostic[] = [];
  const joined = lines.join('\n').toLowerCase();
  const hasFig = /\bfig\./i.test(joined); const hasFigure = /\bfigure\b/i.test(joined);
  const hasTab = /\btab\./i.test(joined); const hasTable = /\btable\b/i.test(joined);
  const ignoredAcronyms = new Set([...(options.ignoredAcronyms ?? []), ...ACRONYM_IGNORE]);
  const definedAcronyms = new Set<string>();
  const seenAcronyms = new Set<string>();

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const definitions = lineDefinitions(line);
    addMatch(out, 'percent-space', 'Use "50%" rather than "50 %".', path, lineNo, line, /\b\d+(?:\.\d+)?\s+%/g);
    addMatch(out, 'p-value-style', 'Use "p-value" rather than "p value".', path, lineNo, line, /\bp\s+value\b/gi);
    addMatch(out, 'p-value-style', 'Use a consistent p-value style (for example, "p < 0.05").', path, lineNo, line, /\bp\s*(?:<|>|=)\s*\d/gi, 'info');
    if (hasFig && hasFigure) addMatch(out, 'figure-style', '"Figure" and "Fig." are both used in this document; choose one style.', path, lineNo, line, /\b(?:Figure|Fig\.)\b/gi, 'info');
    if (hasTab && hasTable) addMatch(out, 'table-style', '"Table" and "Tab." are both used in this document; choose one style.', path, lineNo, line, /\b(?:Table|Tab\.)\b/gi, 'info');
    for (const [us, uk] of VARIANT_PAIRS) {
      if (options.spelling === 'us') addMatch(out, 'spelling-variant', `Use US spelling "${us}" instead of "${uk}".`, path, lineNo, line, new RegExp(`\\b${uk}\\b`, 'gi'), 'info');
      else if (options.spelling === 'uk') addMatch(out, 'spelling-variant', `Use UK spelling "${uk}" instead of "${us}".`, path, lineNo, line, new RegExp(`\\b${us}\\b`, 'gi'), 'info');
      else if (options.spelling !== 'mixed' && new RegExp(`\\b${us}\\b`, 'i').test(joined) && new RegExp(`\\b${uk}\\b`, 'i').test(joined)) {
        addMatch(out, 'spelling-variant', `Both "${us}" and "${uk}" appear; choose US or UK spelling.`, path, lineNo, line, new RegExp(`\\b(?:${us}|${uk})\\b`, 'gi'), 'info');
      }
    }
    for (const match of line.matchAll(/\b[A-Z]{2,8}\b/g)) {
      const acronym = match[0];
      const at = match.index ?? 0;
      if (ignoredAcronyms.has(acronym) || seenAcronyms.has(acronym)) continue;
      seenAcronyms.add(acronym);
      const definedHereBefore = (definitions.get(acronym) ?? Number.MAX_SAFE_INTEGER) <= at;
      if (!definedAcronyms.has(acronym) && !definedHereBefore) {
        out.push({ code: 'undefined-acronym', severity: 'info', message: `Consider defining "${acronym}" at first use.`, path, line: lineNo, column: at + 1 });
      }
    }
    for (const acronym of definitions.keys()) definedAcronyms.add(acronym);
  });
  return out;
}

export function analyzeOpenDocuments(tabs: readonly Tab[], options: WritingOptions = {}): WritingDiagnostic[] {
  return tabs.flatMap(tab => analyzeWriting(tab.content, tab.lang, tab.filePath, options));
}
