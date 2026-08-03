import { normalizePath } from '../files/projectPaths';
import type {
  CompletionCandidate,
  CompletionDocument,
  CompletionProvider,
  CompletionRequest,
} from './types';

const STANDARD_ENVIRONMENTS = [
  'document', 'itemize', 'enumerate', 'description', 'equation', 'equation*',
  'align', 'align*', 'gather', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix',
  'figure', 'table', 'tabular', 'quote', 'center', 'verbatim', 'abstract',
  'theorem', 'lemma', 'proof',
];

/**
 * Strip a Windows extended-length prefix and unify slashes, but PRESERVE casing.
 *
 * Identity comparison uses the shared `normalizePath`, which also folds case.
 * Displayed and inserted completion text must keep the on-disk casing, so this
 * helper is deliberately separate — never use `normalizePath` output as text.
 */
function displayPath(path: string): string {
  let s = path;
  if (s.startsWith('\\\\?\\UNC\\')) s = '\\\\' + s.slice(8);
  else if (s.startsWith('\\\\?\\')) s = s.slice(4);
  return s.replace(/\\/g, '/');
}

/** Directory portion of the Project root, normalized for identity compares. */
function projectDirectory(rootPath: string | null | undefined): string | null {
  if (!rootPath) return null;
  return normalizePath(rootPath).replace(/[^/]*$/, '');
}

/** Directory portion of the Project root, with casing preserved for display. */
function displayProjectDirectory(rootPath: string | null | undefined): string {
  if (!rootPath) return '';
  return displayPath(rootPath).replace(/[^/]*$/, '');
}

function isInsideProject(path: string | null, rootPath: string | null | undefined): boolean {
  if (!path) return false;
  const directory = projectDirectory(rootPath);
  return !directory || normalizePath(path).startsWith(directory);
}

function documents(request: CompletionRequest): CompletionDocument[] {
  const rootPath = request.workspace?.rootPath;
  const activePath = request.workspace?.activePath ?? null;
  const docs = [...(request.workspace?.documents ?? [])]
    .filter(doc => rootPath
      ? isInsideProject(doc.path, rootPath)
      : !!doc.path && !!activePath && normalizePath(doc.path) === normalizePath(activePath));
  const activeIndex = docs.findIndex(doc => doc.path && activePath && normalizePath(doc.path) === normalizePath(activePath));
  const active: CompletionDocument = {
    path: activePath,
    language: request.language,
    text: request.text,
  };
  if (activeIndex >= 0) docs[activeIndex] = active;
  else docs.push(active);
  return docs;
}

function withoutLatexComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => {
      for (let index = 0; index < line.length; index++) {
        if (line[index] !== '%') continue;
        let slashes = 0;
        for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor--) slashes++;
        if (slashes % 2 === 0) return line.slice(0, index);
      }
      return line;
    })
    .join('\n');
}

function uniqueMatches(docs: readonly CompletionDocument[], pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const doc of docs) {
    pattern.lastIndex = 0;
    const text = withoutLatexComments(doc.text);
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const value = match[1]?.trim();
      if (value) found.add(value);
    }
  }
  return [...found];
}

function bibKeys(docs: readonly CompletionDocument[]): string[] {
  return uniqueMatches(docs, /@[A-Za-z]+\s*\{\s*([^,\s}]+)/g);
}

function labels(docs: readonly CompletionDocument[]): string[] {
  return uniqueMatches(docs, /\\label\s*\{([^{}]+)\}/g);
}

function declaredEnvironments(docs: readonly CompletionDocument[]): string[] {
  return uniqueMatches(docs, /\\(?:newenvironment|renewenvironment)\*?\s*\{([^{}]+)\}/g);
}

function openEnvironments(text: string, position: number): string[] {
  const stack: string[] = [];
  const pattern = /\\(begin|end)\s*\{([^{}]+)\}/g;
  const before = withoutLatexComments(text.slice(0, position));
  for (let match = pattern.exec(before); match; match = pattern.exec(before)) {
    const [, action, name] = match;
    if (action === 'begin') stack.push(name);
    else {
      const index = stack.lastIndexOf(name);
      if (index >= 0) stack.splice(index, 1);
    }
  }
  return stack.reverse();
}

function environmentCandidates(request: CompletionRequest, action: 'begin' | 'end'): CompletionCandidate[] {
  const docs = documents(request);
  // Rich built-in begin snippets come from snippetProvider. This provider adds
  // project-declared environments and owns every end candidate, including the
  // open-environment ranking that static snippets cannot provide.
  // Scanned once per request: this runs on the keystroke path, and each scan
  // walks the whole prefix.
  const open = action === 'end' ? openEnvironments(request.text, request.position) : [];
  const nearest = open[0];
  const names = action === 'end'
    ? [...new Set([...open, ...declaredEnvironments(docs), ...STANDARD_ENVIRONMENTS])]
    : declaredEnvironments(docs);

  return names.map(name => ({
    label: `\\${action}{${name}}`,
    insertText: action === 'begin'
      ? `\\begin{${name}}\n  $1\n\\end{${name}}`
      : `\\end{${name}}`,
    detail: action === 'begin' ? 'LaTeX environment' : 'close environment',
    kind: 'environment',
    snippet: action === 'begin',
    boost: action === 'end' && nearest === name ? 50 : 5,
  }));
}

function fileCandidates(request: CompletionRequest, command: string): CompletionCandidate[] {
  const rootPath = request.workspace?.rootPath;
  const root = projectDirectory(rootPath) ?? '';
  const displayRoot = displayProjectDirectory(rootPath);
  const activePath = request.workspace?.activePath;
  const accepts = (relative: string): boolean => {
    if (command === 'input' || command === 'include' || command === 'subfile') return /\.tex$/i.test(relative);
    if (command === 'includegraphics') return /\.(png|jpe?g|pdf|svg|eps)$/i.test(relative);
    return /\.bib$/i.test(relative);
  };

  // Scoped like every other semantic source: Project-restricted when a Project
  // is active, otherwise Active-Document-only so unrelated tabs cannot leak.
  return documents(request).flatMap(doc => {
    if (!doc.path || !isInsideProject(doc.path, rootPath)) return [];
    if (activePath && normalizePath(doc.path) === normalizePath(activePath)) return [];

    const display = displayPath(doc.path);
    const normalized = normalizePath(doc.path);
    let relative = root && normalized.startsWith(root) && displayRoot
      ? display.slice(displayRoot.length)
      : display.split('/').at(-1) ?? display;
    if (!accepts(relative)) return [];

    if ((command === 'input' || command === 'include' || command === 'subfile') && /\.tex$/i.test(relative)) {
      relative = relative.slice(0, -4);
    } else if (command === 'bibliography' && /\.bib$/i.test(relative)) {
      relative = relative.slice(0, -4);
    }

    return [{
      label: relative,
      insertText: relative,
      detail: 'project file',
      kind: 'file' as const,
      boost: 5,
    }];
  });
}

export const latexSemanticProvider: CompletionProvider = {
  complete(request, site) {
    if (request.language !== 'latex') return [];
    const docs = documents(request);

    switch (site.kind) {
      case 'citation':
        return bibKeys(docs).map(key => ({
          label: key,
          insertText: key,
          detail: 'BibTeX citation',
          kind: 'citation',
          boost: 20,
        }));
      case 'reference':
        return labels(docs).map(label => ({
          label,
          insertText: label,
          detail: 'LaTeX label',
          kind: 'reference',
          boost: 20,
        }));
      case 'environment':
        return environmentCandidates(request, site.action);
      case 'file':
        return fileCandidates(request, site.command);
      default:
        return [];
    }
  },
};
