// Parameter lists for user-defined Typst functions (`#let f(a, b: 1) = ..`).
//
// These cannot come from Rust: a `#let` function is a `Repr::Closure`, and
// typst's `Func::params()` returns `None` for closures — the metadata simply is
// not in the binary. So the document is the only source, and it is parsed here.
//
// The cost of that is real and worth stating: we recover parameter *names* and
// default expressions, but no types. Typst infers those at compile time, and
// reproducing that inference means a type checker (which is what tinymist
// built). The tooltip therefore shows a custom function's shape, not its types.

/** One parameter of a user-defined function. */
export interface LetParam {
  name: string;
  /** Default expression as written, e.g. `1` or `(a: 2)`. Null when required. */
  default: string | null;
  /** A `..sink` parameter, which absorbs the remaining arguments. */
  variadic: boolean;
}

/** A `#let` function definition found in the document. */
export interface LetFunction {
  name: string;
  params: LetParam[];
}

/**
 * Cap on the parameter list we will parse, so a runaway unclosed paren costs a
 * bounded amount of work rather than the rest of the document.
 */
const MAX_PARAM_LIST = 2000;

const LET_FUNCTION = /#let\s+([A-Za-z_][\w-]*)\s*\(/g;

/**
 * Split a parameter list on top-level commas only.
 *
 * A default value may itself contain commas, parens, brackets, braces or a
 * string (`#let f(a: (1, 2), b: "x, y") = ..`), so splitting on `,` alone
 * mis-parses. Returns null when the list is unterminated within the cap.
 */
function splitParams(text: string, open: number): { parts: string[]; end: number } | null {
  const parts: string[] = [];
  let depth = 0;
  let start = open + 1;
  const limit = Math.min(text.length, open + MAX_PARAM_LIST);

  for (let i = open + 1; i < limit; i++) {
    const ch = text[i];

    if (ch === '"') {
      // Skip the literal; an unterminated one means the definition is malformed.
      let j = i + 1;
      while (j < limit) {
        if (text[j] === '\\') j += 2;
        else if (text[j] === '"') break;
        else j++;
      }
      if (j >= limit) return null;
      i = j;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ']' || ch === '}') { depth--; continue; }
    if (ch === ')') {
      if (depth === 0) {
        parts.push(text.slice(start, i));
        return { parts, end: i };
      }
      depth--;
      continue;
    }
    if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

const PARAM_NAME = /^[A-Za-z_][\w-]*$/;

function parseParam(raw: string): LetParam | null {
  const part = raw.trim();
  if (!part) return null;

  if (part.startsWith('..')) {
    const name = part.slice(2).trim();
    // A bare `..` is legal and unnamed; give it a placeholder so the tooltip can
    // still show that extra arguments are accepted.
    return { name: name || '..', default: null, variadic: true };
  }

  const colon = part.indexOf(':');
  if (colon === -1) {
    return PARAM_NAME.test(part) ? { name: part, default: null, variadic: false } : null;
  }
  const name = part.slice(0, colon).trim();
  if (!PARAM_NAME.test(name)) return null;
  return { name, default: part.slice(colon + 1).trim() || null, variadic: false };
}

/**
 * Find every `#let` function definition in a document.
 *
 * Non-function bindings (`#let x = 1`) are skipped: the regex requires a `(`
 * directly after the name, which is what distinguishes a function from a value.
 */
export function scanLetFunctions(text: string): LetFunction[] {
  const out: LetFunction[] = [];
  LET_FUNCTION.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LET_FUNCTION.exec(text)) !== null) {
    // `match.index + match[0].length - 1` is the `(` the regex consumed.
    const open = match.index + match[0].length - 1;
    const split = splitParams(text, open);
    if (!split) continue;
    const params = split.parts.map(parseParam).filter((p): p is LetParam => p !== null);
    out.push({ name: match[1], params });
    // Resume after the parameter list so a default containing `#let` cannot
    // start a bogus second match.
    LET_FUNCTION.lastIndex = split.end;
  }
  return out;
}

/**
 * Cached view of one document's `#let` functions, keyed by name.
 *
 * Memoised on the document text: the tooltip recomputes on every cursor move,
 * but the definitions only change when the text does. Same approach as
 * `activePackages` in `cwlProvider.ts`, and single-entry for the same reason —
 * completion only ever asks about the document being edited.
 */
let memoText: string | null = null;
let memoIndex: Map<string, LetFunction> = new Map();

export function letFunctionsFor(text: string): Map<string, LetFunction> {
  if (memoText === text) return memoIndex;
  const index = new Map<string, LetFunction>();
  for (const fn of scanLetFunctions(text)) {
    // A later definition shadows an earlier one, as it would at runtime.
    index.set(fn.name, fn);
  }
  memoText = text;
  memoIndex = index;
  return index;
}

/** Drop the memo. Exported for tests, which reuse the module across cases. */
export function resetLetCacheForTests(): void {
  memoText = null;
  memoIndex = new Map();
}
