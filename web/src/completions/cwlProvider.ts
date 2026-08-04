/**
 * Completion provider backed by the bundled TeXstudio `.cwl` corpus.
 *
 * Design constraint that shapes everything here: the corpus is ~4465 files and
 * ~245k commands, but `complete()` sits on the keystroke path. So:
 *
 *   - Only packages the document actually loads are read (plus their
 *     `#include:` dependencies and the always-on base).
 *   - Reads go through Tauri and are therefore async; `complete()` never awaits
 *     them. It serves whatever is already parsed and kicks off loading in the
 *     background, so the popup is never gated on IPC.
 *   - Parsed packages are cached for the process lifetime. `.cwl` files are
 *     build-time data and do not change while the app runs.
 */

import { hasTauri, ipc } from '../api/tauri';
import { parseCwl, type CwlCommand, type CwlEnvironment, type CwlPackage } from './cwlParser';
import { detectMathContext } from './mathContext';
import type { CompletionCandidate, CompletionProvider, CompletionRequest } from './types';

/**
 * Always loaded: `latex-document.cwl` holds the LaTeX kernel and base classes
 * (`\section`, `\textbf`, `\frac`, ...), which are available without any
 * `\usepackage`.
 */
const BASE_PACKAGES = ['latex-document'];

/** Class-name to cwl mapping. `\documentclass{beamer}` -> `class-beamer.cwl`. */
function classPackageName(documentClass: string): string {
  return `class-${documentClass}`;
}

/** Parsed packages, keyed by cwl name. `null` marks "no such package". */
const cache = new Map<string, CwlPackage | null>();
/** In-flight loads, so concurrent keystrokes do not each fire their own read. */
const inFlight = new Map<string, Promise<void>>();
/** Names known to exist, so we never ask for files that cannot be there. */
let availableNames: Set<string> | null = null;
let availablePromise: Promise<void> | null = null;

/**
 * User-facing behaviour switches.
 *
 * Pushed in rather than read from the settings store because `complete()` is
 * synchronous and on the keystroke path; subscribing here would couple this
 * module to React state for no benefit.
 */
interface CwlOptions {
  enabled: boolean;
  /**
   * Promote `#*` commands to normal rank instead of downranking them.
   *
   * They are never hidden outright: `#*` covers 26% of the corpus and includes
   * genuinely useful commands (`\addcontentsline`, `\arabic`, `\Alph`).
   * TeXstudio itself only tucks them behind an "all" tab rather than dropping
   * them, so filtering by prefix plus a rank penalty is the honest equivalent.
   * Commands marked `#S` are the ones actually meant to be invisible, and the
   * parser drops those.
   */
  showUnusual: boolean;
  respectContext: boolean;
}

let options: CwlOptions = { enabled: true, showUnusual: false, respectContext: true };

export function setCwlOptions(next: Partial<CwlOptions>): void {
  options = { ...options, ...next };
}

/** Reset all state. Tests only. */
export function resetCwlCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  availableNames = null;
  availablePromise = null;
}

function ensureAvailableNames(): void {
  if (availableNames || availablePromise) return;
  // `ipc` throws *synchronously* outside the app shell, so it cannot be reached
  // without this guard: an unguarded throw inside a React effect black-screens
  // the app (see the note above `appWindow` in api/tauri.ts). Browser preview
  // and `vite dev` in a plain tab both land here.
  if (!hasTauri()) {
    availableNames = new Set();
    return;
  }
  availablePromise = ipc
    .listCwlPackages()
    .then(names => {
      availableNames = new Set(names);
    })
    .catch(() => {
      // Corpus missing (a checkout without `node tools/fetch-cwl.mjs`). Treat as
      // empty rather than retrying on every keystroke.
      availableNames = new Set();
    })
    .finally(() => {
      availablePromise = null;
    });
}

/**
 * Start loading a package if it is not already cached or in flight.
 * Dependencies are loaded transitively as each file is parsed.
 */
function requestPackage(name: string): void {
  if (cache.has(name) || inFlight.has(name)) return;
  if (!hasTauri()) {
    cache.set(name, null);
    return;
  }
  // Skip names we know are absent; without this, a document loading a dozen
  // uncovered packages would fire a dozen doomed reads on every scan.
  if (availableNames && !availableNames.has(name)) {
    cache.set(name, null);
    return;
  }

  const load = ipc
    .readCwl(name)
    .then(text => {
      const pkg = text === null ? null : parseCwl(text, name);
      cache.set(name, pkg);
      if (pkg) for (const dep of pkg.deps) requestPackage(dep);
    })
    .catch(() => {
      // Cache the failure: a malformed or unreadable file should not be retried
      // on every keystroke.
      cache.set(name, null);
    })
    .finally(() => {
      inFlight.delete(name);
    });

  inFlight.set(name, load);
}

/** Strip comments so a `%`-commented `\usepackage` is not treated as active. */
function withoutComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== '%') continue;
        let slashes = 0;
        for (let c = i - 1; c >= 0 && line[c] === '\\'; c--) slashes++;
        if (slashes % 2 === 0) return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/**
 * Package names loaded by a document: `\usepackage{a,b}`, `\RequirePackage{}`,
 * and the document class.
 */
function scanPackages(text: string): string[] {
  const found = new Set<string>(BASE_PACKAGES);
  const source = withoutComments(text);

  const usePattern = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g;
  for (let m = usePattern.exec(source); m; m = usePattern.exec(source)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim();
      if (name) found.add(name);
    }
  }

  const classPattern = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g;
  for (let m = classPattern.exec(source); m; m = classPattern.exec(source)) {
    const name = m[1].trim();
    if (name) found.add(classPackageName(name));
  }

  return [...found];
}

/**
 * Cache the package scan per document text.
 *
 * `complete()` runs on every keystroke and the scan walks the whole document,
 * so repeating it unchanged is exactly the redundant-rescan cost that has bitten
 * this module before.
 */
let lastScanText: string | null = null;
let lastScanResult: string[] = [];

function packagesFor(text: string): string[] {
  if (text === lastScanText) return lastScanResult;
  lastScanText = text;
  lastScanResult = scanPackages(text);
  return lastScanResult;
}

/** Every parsed package reachable from the document, following `#include:`. */
function activePackages(text: string): CwlPackage[] {
  ensureAvailableNames();

  const wanted = packagesFor(text);
  const seen = new Set<string>();
  const out: CwlPackage[] = [];
  const queue = [...wanted];

  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);

    if (!cache.has(name)) {
      requestPackage(name);
      continue; // Not available yet; a later keystroke will pick it up.
    }
    const pkg = cache.get(name);
    if (!pkg) continue;
    out.push(pkg);
    queue.push(...pkg.deps);
  }
  return out;
}

/** `#*` commands are real but rarely wanted, so they sort below the rest. */
const BOOST_NORMAL = 2;
const BOOST_UNUSUAL = -10;

/** Rank for a candidate, honouring the `showUnusual` preference. */
function rankFor(unusual: boolean): number {
  if (!unusual || options.showUnusual) return BOOST_NORMAL;
  return BOOST_UNUSUAL;
}

function commandCandidate(command: CwlCommand, pkg: string): CompletionCandidate {
  return {
    label: command.label,
    insertText: command.snippet,
    detail: pkg,
    kind: 'command',
    snippet: command.hasFields,
    snippetSyntax: 'cm6',
    boost: rankFor(command.unusual),
  };
}

function environmentCandidate(environment: CwlEnvironment, pkg: string): CompletionCandidate {
  return {
    label: environment.label,
    insertText: environment.snippet,
    detail: pkg,
    kind: 'environment',
    snippet: true,
    snippetSyntax: 'cm6',
    boost: rankFor(environment.unusual),
  };
}

/**
 * Warm the cache for a document's packages.
 *
 * `complete()` never awaits IPC, so without this the first `\` in a freshly
 * opened document would show built-in snippets only, with corpus commands
 * appearing a keystroke or two later. Calling this when a LaTeX document opens
 * moves that latency off the typing path.
 *
 * Never throws. It is called from a React effect, where an escaping error would
 * take down the editor pane rather than merely degrading completion.
 */
export function prefetchCwlForDocument(text: string): void {
  try {
    ensureAvailableNames();
    for (const name of packagesFor(text)) requestPackage(name);
  } catch {
    // Completion data is a nice-to-have; the editor must still open.
  }
}

/**
 * Whether a command is valid at a position, per its cwl classifiers.
 *
 * `#m` / `#n` / `#t` / `/env` are what make the corpus usable: without them
 * every one of the ~236k commands is offered everywhere, and typing prose means
 * wading through math operators.
 */
function isApplicable(command: CwlCommand, math: boolean, envs: readonly string[]): boolean {
  if (command.mathOnly && !math) return false;
  if (command.textOnly && math) return false;
  // `#t` means tabular-like. Resolve it through the environment stack rather
  // than a fixed list, so `tabularx`/`longtable` and friends work too.
  if (command.tabularOnly && !envs.some(env => /tabular|array|longtable|tabu|matrix/i.test(env))) {
    return false;
  }
  if (command.envs && !command.envs.some(allowed => envs.includes(allowed))) return false;
  return true;
}

export const cwlProvider: CompletionProvider = {
  complete(request: CompletionRequest, site) {
    if (request.language !== 'latex' || !options.enabled) return [];
    // Citations, references and file paths are document-derived; the corpus has
    // nothing to add there and `latexSemanticProvider` owns them.
    if (site.kind === 'citation' || site.kind === 'reference' || site.kind === 'file') return [];

    // The engine already isolates provider failures, but returning [] beats
    // relying on that: a throw here would drop the built-in snippets from the
    // same popup.
    let packages: CwlPackage[];
    try {
      packages = activePackages(request.text);
    } catch {
      return [];
    }

    if (site.kind === 'environment') {
      // `\end{...}` pairing is ranked by `latexSemanticProvider` from the open
      // environment stack, which beats a static list.
      if (site.action === 'end') return [];
      return packages.flatMap(pkg =>
        pkg.environments.map(environment => environmentCandidate(environment, pkg.name)));
    }

    if (site.kind === 'command') {
      const { math, envs } = options.respectContext
        ? detectMathContext(request.text, request.position)
        : { math: false, envs: [] as string[] };
      return packages.flatMap(pkg => pkg.commands
        .filter(command => !options.respectContext || isApplicable(command, math, envs))
        .map(command => commandCandidate(command, pkg.name)));
    }

    return [];
  },
};
