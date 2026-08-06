// Bounded, syntax-light Typst workspace scope discovery.
//
// This is intentionally not a Typst evaluator: dynamic imports, package imports,
// conditionals, and #show transformations cannot be resolved safely from text.
// It recognizes only static quoted relative .typ imports from the CompletionWorkspace
// snapshot and follows at most a small, cycle-safe import graph.

import type { CompletionWorkspace } from './types';
import type { LetFunction } from './typstLetScan';
import { scanLetFunctions } from './typstLetScan';
import { normalizePath } from '../files/projectPaths';

const MAX_IMPORT_DEPTH = 12;
const MAX_VISITED_FILES = 80;

export interface TypstWorkspaceSymbol {
  name: string;
  kind: 'function' | 'value' | 'module';
  params?: LetFunction['params'];
  sourcePath: string | null;
  imported: boolean;
}

interface StaticImport {
  path: string;
  all: boolean;
  names: Array<{ source: string; local: string }>;
  alias: string | null;
}


function maskComments(text: string): string {
  let out = '';
  let block = false;
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]; const next = text[i + 1];
    if (block) {
      if (ch === '*' && next === '/') { out += '  '; i++; block = false; }
      else out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote) {
      if (ch === '\\') { out += '  '; i++; continue; }
      if (ch === '"') quote = false;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '*') { out += '  '; i++; block = true; continue; }
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      if (end === -1) return out + ' '.repeat(text.length - i);
      out += ' '.repeat(end - i); i = end - 1; continue;
    }
    if (ch === '"') quote = true;
    out += ch;
  }
  return out;
}

function staticImports(text: string): StaticImport[] {
  const out: StaticImport[] = [];
  const masked = maskComments(text);
  const re = /#import\s+"([^"\r\n]+)"(?:\s+as\s+([A-Za-z_][\w-]*)|\s*:\s*([^\r\n]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(masked)) !== null) {
    const selectors = (match[3] ?? '').trim();
    const names: StaticImport['names'] = [];
    for (const part of selectors.split(',')) {
      const item = part.trim();
      if (!item || item === '*') continue;
      const alias = /^([A-Za-z_][\w-]*)(?:\s+as\s+([A-Za-z_][\w-]*))?$/.exec(item);
      if (alias) names.push({ source: alias[1], local: alias[2] ?? alias[1] });
    }
    out.push({ path: match[1], all: selectors.split(',').some(part => part.trim() === '*'), names, alias: match[2] ?? null });
  }
  return out;
}

function localSymbols(text: string, sourcePath: string | null): Map<string, TypstWorkspaceSymbol> {
  const out = new Map<string, TypstWorkspaceSymbol>();
  for (const fn of scanLetFunctions(text)) {
    out.set(fn.name, { name: fn.name, kind: 'function', params: fn.params, sourcePath, imported: false });
  }
  const masked = maskComments(text);
  const values = /#let\s+([A-Za-z_][\w-]*)\s*=(?!>)/g;
  let match: RegExpExecArray | null;
  while ((match = values.exec(masked)) !== null) {
    if (!out.has(match[1])) out.set(match[1], { name: match[1], kind: 'value', sourcePath, imported: false });
  }
  return out;
}

function resolveImport(
  raw: string,
  current: string | null,
  workspace: CompletionWorkspace,
  docs: Map<string, { path: string | null; text: string }>,
): { path: string | null; text: string } | null {
  if (!current || !workspace.rootPath || !raw.toLowerCase().endsWith('.typ')) return null;
  if (/^(?:[A-Za-z]:[\\/]|[\\/]|https?:|@)/i.test(raw)) return null;
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  const pieces = normalized.split('/');
  if (pieces.some(piece => !piece || piece === '.' || piece === '..')) return null;
  const currentDir = normalizePath(current).replace(/\/[^/]*$/, '');
  const candidate = normalizePath(`${currentDir}/${pieces.join('/')}`);
  const root = normalizePath(workspace.rootPath).replace(/\/$/, '');
  if (!candidate.startsWith(`${root}/`)) return null;
  return docs.get(candidate) ?? null;
}

/**
 * Symbols visible from static workspace imports plus the active document.
 * Later local definitions win over imported names. Dynamic/package imports are
 * intentionally omitted rather than guessed.
 */
export function typstWorkspaceSymbols(workspace: CompletionWorkspace | undefined): Map<string, TypstWorkspaceSymbol> {
  const active = workspace?.activePath;
  if (!workspace || !active) return new Map();
  const docs = new Map<string, { path: string | null; text: string }>();
  for (const document of workspace.documents) {
    if (document.language === 'typst' && document.path) docs.set(normalizePath(document.path), document);
  }
  const root = docs.get(normalizePath(active));
  if (!root) return new Map();
  const result = new Map<string, TypstWorkspaceSymbol>();
  const visited = new Set<string>();

  const visit = (document: { path: string | null; text: string }, depth: number): Map<string, TypstWorkspaceSymbol> => {
    const own = localSymbols(document.text, document.path);
    if (!document.path || depth >= MAX_IMPORT_DEPTH || visited.size >= MAX_VISITED_FILES) return own;
    const key = normalizePath(document.path);
    if (visited.has(key)) return own;
    visited.add(key);
    const imported = new Map<string, TypstWorkspaceSymbol>();
    for (const spec of staticImports(document.text)) {
      const target = resolveImport(spec.path, document.path, workspace, docs);
      if (!target) continue;
      const exports = visit(target, depth + 1);
      if (spec.alias) {
        imported.set(spec.alias, { name: spec.alias, kind: 'module', sourcePath: target.path, imported: true });
      }
      if (spec.all) {
        for (const symbol of exports.values()) imported.set(symbol.name, { ...symbol, imported: true });
      }
      for (const picked of spec.names) {
        const symbol = exports.get(picked.source);
        if (symbol) imported.set(picked.local, { ...symbol, name: picked.local, imported: true });
      }
    }
    return new Map([...imported, ...own]);
  };

  for (const [name, symbol] of visit(root, 0)) result.set(name, symbol);
  return result;
}
