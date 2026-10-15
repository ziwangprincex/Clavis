// What a citation key or a label stands for, so the completion list can say
// more than "BibTeX citation": author, year and title for a key, and the
// section, caption or equation a label belongs to, as Texifier's completion
// info box shows them. Plain text scanning over the open documents; nothing
// here evaluates TeX.

import type { CompletionDocument } from './types';

export interface SourceLine { path: string | null; line: number }

export interface BibSummary extends SourceLine {
  key: string;
  author: string | null;
  year: string | null;
  title: string | null;
}

export interface LabelSummary extends SourceLine {
  label: string;
  /** Figure, Table, Equation, Section … — null when nothing encloses it. */
  kind: string | null;
  /** Caption, heading or equation text, flattened. */
  text: string | null;
}

/** Index of the brace closing the one at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/** `{The {\TeX}book}` → `The TeXbook`: braces and simple accent commands dropped. */
export function flatten(value: string): string {
  return value
    .replace(/\\[`'^"~=.uvHcdbtk]\s*\{?([A-Za-z])\}?/g, '$1')
    .replace(/\\(?:emph|textit|textbf|textsc|mathrm|mbox|text)\s*/g, '')
    .replace(/\\([A-Za-z]+)\s*/g, '$1')
    .replace(/[{}$]/g, '')
    .replace(/~/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

/** Fields of one entry body (`title = {…}, year = 1984`). */
function fields(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const field = /([A-Za-z][\w-]*)\s*=\s*/g;
  for (let match = field.exec(body); match; match = field.exec(body)) {
    let start = field.lastIndex, end: number;
    if (body[start] === '{') {
      end = closing(body, start);
      if (end < 0) break;
      out.set(match[1].toLowerCase(), body.slice(start + 1, end));
    } else if (body[start] === '"') {
      end = body.indexOf('"', start + 1);
      if (end < 0) break;
      out.set(match[1].toLowerCase(), body.slice(start + 1, end));
    } else {
      end = start;
      while (end < body.length && body[end] !== ',' && body[end] !== '\n') end++;
      out.set(match[1].toLowerCase(), body.slice(start, end).trim());
    }
    field.lastIndex = end + 1;
  }
  return out;
}

/** `Knuth, Donald E. and Lamport, Leslie` → `Knuth et al.`; `Donald Knuth` → `Knuth`. */
export function shortAuthor(authors: string): string {
  const people = authors.split(/\s+and\s+/i).map(person => person.trim()).filter(Boolean);
  if (!people.length) return '';
  const first = flatten(people[0]);
  const family = first.includes(',') ? first.split(',')[0].trim() : first.split(/\s+/).pop() ?? first;
  return people.length > 2 ? `${family} et al.` : people.length === 2 ? `${family} & ${shortAuthor(people[1])}` : family;
}

/** Every entry of the open .bib documents (and inline bibliographies). */
export function bibSummaries(docs: readonly CompletionDocument[]): BibSummary[] {
  const out: BibSummary[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    const head = /@([A-Za-z]+)\s*\{\s*([^,\s}]+)\s*,/g;
    for (let match = head.exec(doc.text); match; match = head.exec(doc.text)) {
      const type = match[1].toLowerCase();
      if (type === 'comment' || type === 'string' || type === 'preamble' || seen.has(match[2])) continue;
      const open = doc.text.indexOf('{', match.index);
      const end = closing(doc.text, open);
      const body = doc.text.slice(head.lastIndex, end < 0 ? undefined : end);
      const f = fields(body);
      const author = f.get('author') ?? f.get('editor') ?? null;
      const year = f.get('year') ?? f.get('date')?.slice(0, 4) ?? null;
      const title = f.get('title') ?? null;
      seen.add(match[2]);
      out.push({
        key: match[2],
        author: author ? flatten(author) : null,
        year: year ? flatten(year) : null,
        title: title ? flatten(title) : null,
        path: doc.path,
        line: lineOf(doc.text, match.index),
      });
    }
  }
  return out;
}

/** The short form shown beside a key: `Knuth 1984`. */
export function bibDetail(entry: BibSummary): string {
  const author = entry.author ? shortAuthor(entry.author) : '';
  return [author, entry.year].filter(Boolean).join(' ') || 'BibTeX citation';
}

const SECTION = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/g;
const KINDS: Record<string, string> = {
  figure: 'Figure', 'figure*': 'Figure', subfigure: 'Figure', wrapfigure: 'Figure',
  table: 'Table', 'table*': 'Table', subtable: 'Table',
  equation: 'Equation', 'equation*': 'Equation', align: 'Equation', 'align*': 'Equation', gather: 'Equation',
  multline: 'Equation', eqnarray: 'Equation', flalign: 'Equation', alignat: 'Equation',
  theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition', corollary: 'Corollary', definition: 'Definition',
  example: 'Example', remark: 'Remark', lstlisting: 'Listing', listing: 'Listing', algorithm: 'Algorithm',
};
const SECTIONS: Record<string, string> = {
  part: 'Part', chapter: 'Chapter', section: 'Section', subsection: 'Subsection', subsubsection: 'Subsubsection', paragraph: 'Paragraph',
};

/** The innermost environment still open at `offset`, with where it starts and ends. */
function enclosingEnvironment(text: string, offset: number): { name: string; start: number; end: number } | null {
  const stack: { name: string; start: number }[] = [];
  const env = /\\(begin|end)\s*\{([^{}]+)\}/g;
  for (let match = env.exec(text); match && match.index < offset; match = env.exec(text)) {
    if (match[1] === 'begin') stack.push({ name: match[2], start: match.index });
    else if (stack.length && stack[stack.length - 1].name === match[2]) stack.pop();
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    if (!KINDS[stack[i].name]) continue;
    const close = text.indexOf(`\\end{${stack[i].name}}`, offset);
    return { ...stack[i], end: close < 0 ? text.length : close };
  }
  return null;
}

function describeLabel(text: string, offset: number): { kind: string | null; text: string | null } {
  const env = enclosingEnvironment(text, offset);
  if (env) {
    const kind = KINDS[env.name];
    const body = text.slice(env.start, env.end);
    const caption = /\\caption\s*(?:\[[^\]]*\])?\s*\{/.exec(body);
    if (caption) {
      const open = env.start + caption.index + caption[0].length - 1;
      const close = closing(text, open);
      if (close > open) return { kind, text: flatten(text.slice(open + 1, close)) };
    }
    if (kind === 'Equation') {
      const math = body.replace(/^\\begin\{[^}]+\}/, '').replace(/\\label\{[^}]*\}/g, '');
      return { kind, text: math.replace(/\s+/g, ' ').trim().slice(0, 80) || null };
    }
    return { kind, text: null };
  }
  let section: { kind: string; open: number } | null = null;
  SECTION.lastIndex = 0;
  for (let match = SECTION.exec(text); match && match.index < offset; match = SECTION.exec(text)) {
    section = { kind: SECTIONS[match[1]], open: SECTION.lastIndex - 1 };
  }
  if (!section) return { kind: null, text: null };
  const close = closing(text, section.open);
  return { kind: section.kind, text: close > 0 ? flatten(text.slice(section.open + 1, close)) : null };
}

/** Every `\label` of the documents, with what it labels. Comments are skipped. */
export function labelSummaries(docs: readonly CompletionDocument[], stripComments: (text: string) => string): LabelSummary[] {
  const out: LabelSummary[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    // Comments removed line by line, so line numbers still match the document.
    const text = stripComments(doc.text);
    const label = /\\label\s*\{([^{}]+)\}/g;
    for (let match = label.exec(text); match; match = label.exec(text)) {
      const name = match[1].trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ label: name, ...describeLabel(text, match.index), path: doc.path, line: lineOf(text, match.index) });
    }
  }
  return out;
}
