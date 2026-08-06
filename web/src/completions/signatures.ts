// Resolve a call site to a displayable signature.
//
// Three sources feed this, and the split is forced by where the data lives:
//
//   Typst builtins  — Rust reads `Func::params()` off the standard library and
//                     hands over the whole table once (see `src/typst_sig.rs`).
//                     Fetched lazily here and cached for the session; the data
//                     is a compile-time constant, so nothing invalidates it.
//   Typst `#let`    — parsed out of the document, because closures carry no
//                     introspectable parameters (`typstLetScan.ts`).
//   LaTeX commands  — recovered from the `.cwl` corpus the completion provider
//                     already loads, by reading argument names back out of the
//                     snippet template.
//
// Everything here is synchronous. The tooltip refreshes on every cursor move, so
// a fetch on the hot path is not an option: a miss returns null and the next
// keystroke gets the answer.

import { hasTauri, ipc, type TypstFuncSig } from '../api/tauri';
import type { CallSite } from './callSite';
import { findCwlCommand } from './cwlProvider';
import { letFunctionsFor } from './typstLetScan';
import { scanLatexMacros } from './latexMacroScan';

/** One parameter, as the tooltip renders it. */
export interface SignatureParam {
  name: string;
  /** Rendered type, or empty when unknown (always empty for `#let`). */
  type: string;
  /** One-sentence description, or empty. */
  docs: string;
  required: boolean;
  variadic: boolean;
  /**
   * Whether this parameter occupies a positional slot. Builtin options are
   * named-only and must not consume an index; `#let` parameters all can.
   */
  positionalSlot?: boolean;
}

/** A signature ready to display. */
export interface Signature {
  /** Name as called, e.g. `figure`, `calc.pow`, `frac`. */
  name: string;
  params: SignatureParam[];
  /** Index into `params` of the active one, or -1 when it cannot be placed. */
  activeIndex: number;
  /** Return type, when known. */
  returns: string;
  /** True for a user-defined function, where types are unavailable. */
  userDefined: boolean;
}

// --- Typst builtin table -----------------------------------------------------

let builtins: Map<string, TypstFuncSig> | null = null;
let builtinsPromise: Promise<void> | null = null;
/** Cooldown after a failed fetch, so a missing backend is not retried per key. */
let nextAttemptAt = 0;
const RETRY_MS = 10_000;

/**
 * Kick off loading the builtin table if it is not present.
 *
 * Mirrors `ensureAvailableNames` in `cwlProvider.ts`, including the reason for
 * the cooldown: a failure that latched permanently would silently disable the
 * feature for the whole session.
 */
function ensureBuiltins(): void {
  if (builtins || builtinsPromise) return;
  if (!hasTauri()) return;
  if (Date.now() < nextAttemptAt) return;
  builtinsPromise = ipc
    .listTypstSignatures()
    .then(list => {
      builtins = new Map(list.map(sig => [sig.name, sig]));
      nextAttemptAt = 0;
    })
    .catch(() => {
      // Leave the cache null and retry later rather than latching empty.
      nextAttemptAt = Date.now() + RETRY_MS;
    })
    .finally(() => {
      builtinsPromise = null;
    });
}

/** Drop the cached table. Exported for tests. */
export function resetSignatureCacheForTests(): void {
  builtins = null;
  builtinsPromise = null;
  nextAttemptAt = 0;
}

/**
 * Every builtin signature currently loaded, for the completion provider.
 *
 * Empty until the table arrives, which triggers the fetch as a side effect —
 * completion is synchronous by design, so a cold cache yields nothing and the
 * next keystroke has the data. That first empty answer is why
 * `prefetchTypstSignatures` exists: without it the very first `#` shows only the
 * hand-written snippets.
 */
export function builtinSignatures(): readonly TypstFuncSig[] {
  ensureBuiltins();
  return builtins ? [...builtins.values()] : [];
}

/**
 * Start loading the builtin table before the user types.
 *
 * Called when a Typst document becomes active, mirroring
 * `prefetchCwlForDocument` on the LaTeX side. Safe to call repeatedly: the table
 * is fetched once per session and never invalidates.
 */
export function prefetchTypstSignatures(): void {
  ensureBuiltins();
}

// --- Active parameter placement ---------------------------------------------

/**
 * Place the active parameter within a signature.
 *
 * A named argument (`caption:`) resolves by name. A positional index has to skip
 * parameters that can only be passed by name, since they do not consume a
 * positional slot — without that, `#figure(body, |` would point at whichever
 * named option happens to be second in the list. A variadic parameter absorbs
 * every index from its own position onwards.
 */
function placeActive(params: readonly SignatureParam[], active: number | string): number {
  if (typeof active === 'string') {
    return params.findIndex(p => p.name === active);
  }
  let positional = 0;
  for (let i = 0; i < params.length; i++) {
    if (params[i].variadic) return i;
    // Builtins mark options as named-only; `#let` params leave this undefined.
    if (params[i].positionalSlot === false) continue;
    if (positional === active) return i;
    positional++;
  }
  return -1;
}

// --- Sources -----------------------------------------------------------------

function builtinSignature(site: CallSite): Signature | null {
  ensureBuiltins();
  const sig = builtins?.get(site.callee);
  if (!sig) return null;

  // A `#set` rule only accepts settable parameters, which is how typst's own
  // completion filters them too.
  const source = site.isSet ? sig.params.filter(p => p.settable) : sig.params;
  const params: SignatureParam[] = source.map(p => ({
    name: p.name,
    type: p.typeName,
    docs: p.docs,
    required: p.required,
    variadic: p.variadic,
    positionalSlot: p.positional,
  }));

  return {
    name: sig.name,
    params,
    activeIndex: placeActive(params, site.active),
    returns: sig.returns,
    userDefined: false,
  };
}

function letSignature(text: string, site: CallSite): Signature | null {
  const fn = letFunctionsFor(text).get(site.callee);
  if (!fn) return null;
  const params: SignatureParam[] = fn.params.map(p => ({
    name: p.name,
    // Typst infers closure parameter types at compile time; we cannot, so the
    // default expression is the most useful thing to show in its place.
    type: p.default ? `= ${p.default}` : '',
    docs: '',
    required: !p.variadic && p.default === null,
    variadic: p.variadic,
  }));
  return {
    name: fn.name,
    params,
    activeIndex: placeActive(params, site.active),
    returns: '',
    userDefined: true,
  };
}

/**
 * Recover argument names from a cwl snippet template.
 *
 * `cwlParser` bakes upstream argument names straight into the CM6 snippet
 * (`\frac{${1:num}}{${2:den}}`), keeping `{}` and `[]` distinct, so both the
 * names and their optionality read back out. Parsing the template keeps this
 * change out of the corpus code path; if it ever proves lossy, `CwlCommand` is
 * the place to add a field.
 */
function paramsFromSnippet(snippet: string): SignatureParam[] {
  const params: SignatureParam[] = [];
  const field = /([[{])\$\{(\d+)(?::([^}]*))?\}([\]}])/g;
  let match: RegExpExecArray | null;
  while ((match = field.exec(snippet)) !== null) {
    const optional = match[1] === '[';
    params.push({
      name: match[3] || `arg${match[2]}`,
      type: optional ? 'optional' : '',
      docs: '',
      required: !optional,
      variadic: false,
    });
  }
  return params;
}

function latexSignature(text: string, site: CallSite): Signature | null {
  const macro = scanLatexMacros(text).find(item => item.name === site.callee);
  if (macro) {
    let requiredIndex = 0;
    const params: SignatureParam[] = macro.slots.map(optional => {
      if (optional) return { name: 'optional', type: 'optional', docs: 'Declared optional argument.', required: false, variadic: false };
      requiredIndex++;
      return { name: `arg${requiredIndex}`, type: '', docs: 'Declared mandatory argument.', required: true, variadic: false };
    });
    return { name: macro.name, params, activeIndex: placeActive(params, site.active), returns: '', userDefined: true };
  }
  const command = findCwlCommand(text, site.callee);
  if (!command) return null;
  const params = paramsFromSnippet(command.snippet);
  if (params.length === 0) return null;
  return {
    name: command.name,
    params,
    activeIndex: placeActive(params, site.active),
    returns: '',
    userDefined: false,
  };
}

/**
 * Signature for a call site, or null when none is known.
 *
 * Builtins win over `#let` definitions of the same name, matching typst's own
 * resolution: a document-level `#let figure(..)` shadows the builtin, so the
 * document is checked first for Typst.
 */
export function signatureFor(text: string, site: CallSite, language: string): Signature | null {
  if (language === 'typst') {
    return letSignature(text, site) ?? builtinSignature(site);
  }
  if (language === 'latex') return latexSignature(text, site);
  return null;
}
