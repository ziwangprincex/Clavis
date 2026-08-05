// Typst completion backed by the real standard library.
//
// The hand-written entries in `snippets.ts` cover ~80 constructs; typst has 391
// functions once nested scopes are included (`calc.pow`, `array.map`,
// `table.cell`). Those names come from the same Rust-side table that feeds the
// signature tooltip — `Func::params()` off `Library::default()` — so the list is
// exactly what the installed typst version actually accepts, and it carries real
// parameter names rather than positional placeholders.
//
// `#let` functions defined in the document are offered too, since a document's
// own helpers are the names its author reaches for most.

import { builtinSignatures } from './signatures';
import { letFunctionsFor } from './typstLetScan';
import type { CompletionCandidate, CompletionProvider } from './types';
import type { TypstFuncSig, TypstParamSig } from '../api/tauri';

/**
 * The authoring verbs a fluent Typst user reaches for.
 *
 * Ranking exists because the fallback is alphabetical, and alphabetical order on
 * 391 names is actively hostile: `abs`, `align`, `alpha`, `beta`, `binom` fill
 * the first screen while `heading`, `table` and `text` are nowhere. This list is
 * short and deliberately about *authoring* — structure, text, layout, references
 * — not the utility surface (`assert`, `bit-not`, `repr`).
 */
const COMMON_FUNCTIONS = new Set([
  // structure
  'heading', 'figure', 'table', 'grid', 'list', 'enum', 'terms', 'outline',
  // text
  'text', 'strong', 'emph', 'underline', 'highlight', 'raw', 'quote', 'lorem',
  // layout
  'page', 'par', 'block', 'box', 'align', 'pad', 'stack', 'columns', 'place',
  'pagebreak', 'linebreak', 'colbreak', 'v', 'h',
  // media and references
  'image', 'link', 'ref', 'cite', 'footnote', 'label', 'bibliography',
]);

/** Math functions people actually write, for the in-`$...$` ordering. */
const COMMON_MATH = new Set([
  'frac', 'sqrt', 'sum', 'integral', 'vec', 'mat', 'cases', 'binom', 'abs',
  'norm', 'floor', 'ceil', 'root', 'lr', 'op', 'limits', 'accent', 'bold',
  'italic', 'upright', 'display', 'inline',
]);

/**
 * Boosts, in one place because they only make sense relative to each other and
 * to `snippetProvider`'s (3).
 *
 * `mergeCandidates` in `engine.ts` keys on the label and keeps the highest boost:
 *
 *   18  BOOST_LOCAL    the document's own `#let` helpers — the author's names
 *    3  (curated snippet)  wins any collision; it encodes an authoring idiom
 *    2  BOOST_COMMON   an authoring verb with no curated entry (`heading`, `text`)
 *   -4  BOOST_BUILTIN  the rest of the 391, which alphabetical order can have
 *   -8  BOOST_NESTED   dotted names (`calc.pow`), two thirds of the table
 *
 * `BOOST_COMMON` below the curated value is the important part: `figure` exists
 * in both, and the curated `#figure(image("path.png"), caption: [..])` must win
 * over a generated `#figure(${1:body})`.
 */
const BOOST_COMMON = 2;
const BOOST_BUILTIN = -4;
const BOOST_LOCAL = 18;
const BOOST_NESTED = -8;

/**
 * Functions whose trailing content parameter is idiomatically NOT a content
 * block, because what goes there is another call rather than prose.
 *
 * `figure`'s body is typed `content`, so the general rule below would produce
 * `#figure[...]` — but every example in Typst's own docs writes
 * `#figure(image("a.png"), caption: [..])`, because the body is an image or a
 * table, not text. The curated snippet in `snippets.ts` already gets this right;
 * this set keeps the generated fallback from contradicting it.
 */
const PAREN_BODY_FUNCTIONS = new Set(['figure']);

/**
 * Whether `name` is one of the authoring verbs worth ranking first.
 *
 * Shared with `snippetProvider` so the curated and generated candidates order
 * consistently — otherwise the curated set falls back to the alphabet and
 * `#align`/`#block`/`#box` fill the first screen ahead of `#heading`.
 *
 * Accepts a bare name (`heading`) or a `#set` form (`#set text`), since the
 * curated entries use both.
 */
export function isCommonTypstName(label: string, math: boolean): boolean {
  const bare = label.replace(/^#(?:set\s+|show\s+)?/, '');
  return math ? COMMON_MATH.has(bare) : COMMON_FUNCTIONS.has(bare);
}

/**
 * Whether `position` sits inside a Typst math expression.
 *
 * Typst math is delimited by `$` on both sides, so an odd number of unescaped,
 * un-commented dollars to the left means we are inside one. `mathContext.ts`
 * cannot be reused: it treats `%` as a comment (Typst uses `//`) and encodes
 * LaTeX's `\(`/`\[` forms.
 *
 * Being wrong here only reorders and filters candidates, so a simple scan is the
 * right amount of machinery — a full parse would buy nothing.
 */
export function inTypstMath(text: string, position: number): boolean {
  let dollars = 0;
  for (let i = 0; i < position; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? position : nl;
      continue;
    }
    if (ch === '$') dollars++;
  }
  return dollars % 2 === 1;
}

/**
 * Build the insert template for a function.
 *
 * The shape has to match how Typst is actually written, which the parameter
 * metadata is enough to decide. Typst's spec: "An arbitrary number of content
 * blocks can be passed as trailing arguments to functions. That is,
 * `list([A], [B])` is equivalent to `list[A][B]`." So a trailing
 * `content`-typed positional parameter belongs in a bracket, not a paren:
 *
 *   emph      body!P:content                  → `#emph[${1:body}]`
 *   link      dest!P:str, body!P:content       → `#link("${1:url}")[${2:body}]`
 *   list      children!PV:content (variadic)   → `#list[${1:item}]`
 *   text      (named only), body!P:content     → `#text[${1:body}]`
 *   calc.pow  base!P, exponent!P (no content)  → `#calc.pow(${1:base}, ${2:exponent})`
 *   pagebreak (nothing required)               → `#pagebreak()`
 *
 * `math` suppresses the bracket form entirely. Math functions take `content`
 * parameters too — `frac(num: content, denom: content)` — but are written
 * `$ frac(x, y) $`, never `frac(x)[y]`. Content blocks are markup syntax, so the
 * sugar simply does not read the same way inside `$...$`.
 *
 * Optional and named-only parameters stay out of the template: `text` alone has
 * 30 of them, and the signature tooltip is what surfaces those. Leading required
 * positionals that are *not* content still go in parens, which is what makes
 * `#link("url")[text]` come out right.
 */
function callTemplate(
  name: string,
  params: readonly TypstParamSig[],
  math: boolean,
): { text: string; fields: boolean } {
  const required = params.filter(p => p.positional && (p.required || p.variadic));
  const last = required[required.length - 1];
  const takesContentBlock = !math
    && !!last
    && last.typeName.includes('content')
    && !PAREN_BODY_FUNCTIONS.has(name);

  // The content parameter moves into the bracket; anything before it stays in
  // parens as a positional argument.
  const leading = takesContentBlock ? required.slice(0, -1) : required;
  let field = 0;
  const args = leading.map(p => {
    field++;
    // A string-typed argument needs its quotes, or the insert does not compile.
    return p.typeName.startsWith('str') ? `"\${${field}:${p.name}}"` : `\${${field}:${p.name}}`;
  });

  const parens = args.length > 0 ? `(${args.join(', ')})` : takesContentBlock ? '' : '()';
  const bracket = takesContentBlock ? `[\${${++field}:${last.name}}]` : '';
  return { text: `${name}${parens}${bracket}`, fields: field > 0 };
}

function candidateFor(sig: TypstFuncSig, nested: boolean, math: boolean): CompletionCandidate {
  const { text, fields } = callTemplate(sig.name, sig.params, math);
  const common = math ? COMMON_MATH.has(sig.name) : COMMON_FUNCTIONS.has(sig.name);
  return {
    label: sig.name,
    insertText: text,
    // The upstream title is a human name ("Figure"); the return type says more
    // about how the function is used.
    detail: sig.returns ? `${sig.title || 'function'} → ${sig.returns}` : sig.title || 'function',
    kind: 'command',
    snippet: fields,
    snippetSyntax: 'cm6',
    boost: nested ? BOOST_NESTED : common ? BOOST_COMMON : BOOST_BUILTIN,
  };
}

function localCandidate(name: string, params: readonly { name: string; variadic: boolean; default: string | null }[]): CompletionCandidate {
  const required = params.filter(p => !p.variadic && p.default === null);
  const args = required.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ');
  return {
    label: name,
    insertText: `${name}(${args})`,
    detail: 'local function',
    kind: 'command',
    snippet: required.length > 0,
    snippetSyntax: 'cm6',
    boost: BOOST_LOCAL,
  };
}

/**
 * Typst function completion.
 *
 * Answers `word` sites, which is all `detectCompletionSite` produces for typst —
 * a `#figure` reference arrives as the word `#figure`, so the leading `#` is
 * stripped before matching and re-attached on the way out.
 *
 * Math mode changes both halves of the answer: `$...$` reaches a different scope
 * (`frac` and `vec` exist only there) and calls inside it take no `#`.
 */
export const typstProvider: CompletionProvider = {
  complete(request, site) {
    if (request.language !== 'typst') return [];
    if (site.kind !== 'word' && site.kind !== 'command') return [];

    const raw = site.query;
    const hash = raw.startsWith('#');
    const query = hash ? raw.slice(1) : raw;
    const math = inTypstMath(request.text, request.position);

    // Outside math, typst function names are only meaningful in code mode, which
    // a `#` opens. Without that marker a word is ordinary prose — `page`, `link`
    // and `table` are all common English, and offering 391 functions while
    // someone writes a sentence is worse than offering nothing. Inside `$...$`
    // there is no `#`: `frac(a, b)` is how it is written, so a bare word is a
    // real call site there. An explicit request (Ctrl-Space) overrides either way.
    if (!hash && !math && !request.explicit) return [];

    const out: CompletionCandidate[] = [];
    // The `#` sits inside the replaced range, so CodeMirror filters candidates
    // against a pattern that *includes* it (`state.sliceDoc(from, to)`). A label
    // of `figure` therefore never matches a `#figu` pattern and is dropped after
    // we return it — silently, and invisibly to any test that stops at this
    // provider. Labels carry the hash for that reason, and it is also what the
    // user sees, matching how the name is written in a document.
    const emit = (candidate: CompletionCandidate) => {
      out.push(hash
        ? { ...candidate, label: `#${candidate.label}`, insertText: `#${candidate.insertText}` }
        : candidate);
    };

    for (const fn of letFunctionsFor(request.text).values()) {
      if (query && !fn.name.startsWith(query)) continue;
      emit(localCandidate(fn.name, fn.params));
    }

    for (const sig of builtinSignatures()) {
      // `frac`, `vec` and ~38 others live only in the math scope, so offering
      // them in markup would propose code that does not compile.
      if (sig.mathOnly && !math) continue;
      const nested = sig.name.includes('.');
      // Dotted names also match on the segment after the dot, so `pow` finds
      // `calc.pow` without the user having to remember the module.
      const tail = nested ? sig.name.slice(sig.name.indexOf('.') + 1) : sig.name;
      if (query && !sig.name.startsWith(query) && !tail.startsWith(query)) continue;
      emit(candidateFor(sig, nested, math));
    }

    return out;
  },
};
