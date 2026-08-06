// Bounded LaTeX declaration scanning for editor assistance.
//
// This intentionally recognizes declaration shapes, not TeX expansion. It does
// not execute macros, chase \input, or infer the meaning of xparse argument
// specifications beyond required versus optional slots.

import { normalizePath } from '../files/projectPaths';
import type { CompletionDocument, CompletionWorkspace } from './types';

const MAX_DECLARATIONS = 500;
const MAX_XPARSE_SPEC = 600;

export interface LatexMacro {
  name: string;
  required: number;
  optional: boolean;
  /** Declaration-order slots; true is optional. */
  slots: boolean[];
  sourcePath: string | null;
  imported: boolean;
}

function withoutCommentsAndVerbatim(text: string): string {
  const withoutVerbatim = text.replace(/\\begin\{(?:verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{(?:verbatim\*?|lstlisting|minted)\}/g, match => match.replace(/[^\n]/g, ' '));
  return withoutVerbatim.split(/\r?\n/).map(line => {
    for (let index = 0; index < line.length; index++) {
      if (line[index] !== '%') continue;
      let slashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor--) slashes++;
      if (slashes % 2 === 0) return line.slice(0, index);
    }
    return line;
  }).join('\n');
}

function nameFrom(match: RegExpExecArray): string | null {
  const name = match[1] ?? match[2];
  return name && /^[A-Za-z@]+$/.test(name) ? name : null;
}

function xparseShape(spec: string): { required: number; optional: boolean; slots: boolean[] } | null {
  if (spec.length > MAX_XPARSE_SPEC) return null;
  const slots: boolean[] = [];
  for (let i = 0; i < spec.length; i++) {
    const kind = spec[i];
    if (kind === 'm' || kind === 'r' || kind === 'R' || kind === 'v' || kind === 'b') slots.push(false);
    else if ('OoDdSsEtTGuul'.includes(kind)) slots.push(true);
    if (kind === 'O' || kind === 'D' || kind === 'R' || kind === 'd' || kind === 'r' || kind === 'G') {
      const open = spec[i + 1]; const close = open === '{' ? '}' : open === '[' ? ']' : open === '<' ? '>' : null;
      if (close) {
        const end = spec.indexOf(close, i + 2);
        if (end < 0) return null;
        i = end;
      }
    }
  }
  return { required: slots.filter(slot => !slot).length, optional: slots.some(Boolean), slots };
}

export function scanLatexMacros(text: string, sourcePath: string | null = null): LatexMacro[] {
  const out = new Map<string, LatexMacro>();
  const source = withoutCommentsAndVerbatim(text);
  const classic = /\\(?:newcommand|renewcommand|providecommand)\*?\s*(?:\{\\([A-Za-z@]+)\}|\\([A-Za-z@]+))\s*(?:\[([0-9])\])?\s*(\[[^\]\r\n]*\])?/g;
  let match: RegExpExecArray | null;
  while ((match = classic.exec(source)) !== null && out.size < MAX_DECLARATIONS) {
    const name = nameFrom(match); if (!name) continue;
    const slots = Number(match[3] ?? 0);
    const optional = !!match[4];
    const declarationSlots = [...(optional ? [true] : []), ...Array.from({ length: Math.max(0, slots - (optional ? 1 : 0)) }, () => false)];
    out.set(name, { name, required: declarationSlots.filter(slot => !slot).length, optional, slots: declarationSlots, sourcePath, imported: false });
  }
  const xparseStart = /\\(?:NewDocumentCommand|RenewDocumentCommand|ProvideDocumentCommand)\s*/g;
  while ((match = xparseStart.exec(source)) !== null && out.size < MAX_DECLARATIONS) {
    let cursor = xparseStart.lastIndex;
    const named = /^\\([A-Za-z@]+)/.exec(source.slice(cursor));
    if (!named) continue;
    const name = named[1]; cursor += named[0].length;
    while (/\s/.test(source[cursor] ?? '')) cursor++;
    if (source[cursor] !== '{') continue;
    let depth = 1; const specStart = ++cursor;
    while (cursor < source.length && depth > 0 && cursor - specStart <= MAX_XPARSE_SPEC) {
      if (source[cursor] === '{') depth++;
      else if (source[cursor] === '}') depth--;
      cursor++;
    }
    if (depth !== 0) continue;
    const shape = xparseShape(source.slice(specStart, cursor - 1));
    if (!shape) continue;
    out.set(name, { name, ...shape, sourcePath, imported: false });
    xparseStart.lastIndex = cursor;
  }
  return [...out.values()];
}

function workspaceDocuments(workspace: CompletionWorkspace | undefined, activeText: string): CompletionDocument[] {
  if (!workspace) return [{ path: null, language: 'latex', text: activeText }];
  const root = workspace.rootPath ? normalizePath(workspace.rootPath).replace(/\/$/, '') : null;
  const active = workspace.activePath ? normalizePath(workspace.activePath) : null;
  const docs = workspace.documents.filter(document => document.language === 'latex' && (!root || !!document.path && normalizePath(document.path).startsWith(`${root}/`)));
  // Process the active document last so its declarations have normal TeX-like
  // precedence over project snapshot declarations with the same name.
  const withoutActive = docs.filter(document => !document.path || !active || normalizePath(document.path) !== active);
  return [...withoutActive, { path: workspace.activePath, language: 'latex', text: activeText }];
}

/** Workspace macro map. Active-document declarations override other snapshots. */
export function latexWorkspaceMacros(workspace: CompletionWorkspace | undefined, activeText: string): Map<string, LatexMacro> {
  const docs = workspaceDocuments(workspace, activeText);
  const active = workspace?.activePath ? normalizePath(workspace.activePath) : null;
  const result = new Map<string, LatexMacro>();
  for (const document of docs) {
    const imported = !!document.path && normalizePath(document.path) !== active;
    for (const macro of scanLatexMacros(document.text, document.path)) {
      result.set(macro.name, { ...macro, imported });
    }
  }
  return result;
}


/** 1-based declaration line for an already-recognized macro name, or null. */
export function latexMacroDeclarationLine(text: string, name: string): number | null {
  const source = withoutCommentsAndVerbatim(text);
  const patterns = [
    new RegExp(String.raw`\\(?:newcommand|renewcommand|providecommand)\*?\s*(?:\{\\${name}\}|\\${name})(?:\s*\[[0-9]\])?(?:\s*\[[^\]\r\n]*\])?`, 'g'),
    new RegExp(String.raw`\\(?:NewDocumentCommand|RenewDocumentCommand|ProvideDocumentCommand)\s*\\${name}\s*\{`, 'g'),
  ];
  let offset: number | null = null;
  for (const pattern of patterns) {
    const hit = pattern.exec(source);
    if (hit && (offset === null || hit.index < offset)) offset = hit.index;
  }
  return offset === null ? null : source.slice(0, offset).split('\n').length;
}


export interface LatexEnvironmentDeclaration {
  name: string;
  sourcePath: string | null;
  imported: boolean;
}

export function scanLatexEnvironmentDeclarations(text: string, sourcePath: string | null = null): LatexEnvironmentDeclaration[] {
  const source = withoutCommentsAndVerbatim(text);
  const found = new Map<string, LatexEnvironmentDeclaration>();
  const re = /\\(?:newenvironment|renewenvironment|newtheorem\*?)\s*\{([A-Za-z][\w*@.-]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null && found.size < MAX_DECLARATIONS) found.set(match[1], { name: match[1], sourcePath, imported: false });
  return [...found.values()];
}

export function latexEnvironmentDeclarationLine(text: string, name: string): number | null {
  const source = withoutCommentsAndVerbatim(text);
  const re = new RegExp(String.raw`\\(?:newenvironment|renewenvironment|newtheorem\*?)\s*\{${name}\}`, 'g');
  const match = re.exec(source);
  return match ? source.slice(0, match.index).split('\n').length : null;
}

export function latexWorkspaceEnvironments(workspace: CompletionWorkspace | undefined, activeText: string): Map<string, LatexEnvironmentDeclaration> {
  const active = workspace?.activePath ? normalizePath(workspace.activePath) : null;
  const output = new Map<string, LatexEnvironmentDeclaration>();
  for (const document of workspaceDocuments(workspace, activeText)) {
    const imported = !!document.path && normalizePath(document.path) !== active;
    for (const environment of scanLatexEnvironmentDeclarations(document.text, document.path)) output.set(environment.name, { ...environment, imported });
  }
  return output;
}
