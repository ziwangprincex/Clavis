// Call-site detection for the parameter signature tooltip: given a cursor, work
// out which function call encloses it and which parameter is being written.
//
// Two deliberate design choices:
//
// **Forward scanning from a bounded start.** Scanning backwards from the cursor
// cannot tell whether a position sits inside a string or a comment — `"a, b"`
// looks identical to real syntax when read right-to-left. So we pick a nearby
// safe start (a blank line, else a hard character budget) and scan forwards from
// there with a delimiter stack, which resolves strings and comments correctly.
//
// **A hard scan bound.** The previous site detector in `context.ts` had an
// unbounded regex whose character class excluded neither newlines nor length, so
// a single unclosed `[` claimed the rest of the document and silently disabled
// the completion popup (see `regressions.test.ts`, "an unclosed [ must not
// swallow completion"). Every scan here starts at `scanStart`, so an unclosed
// delimiter can never cost more than `MAX_SCAN` characters of context.

import type { Lang } from '../store';

/** Where the cursor sits, in terms of the enclosing call. */
export interface CallSite {
  /** Callee as written, e.g. `figure` or `calc.pow` (no leading `#`). */
  callee: string;
  /**
   * Which parameter is being written: a zero-based positional index, or the
   * parameter's name once the user has typed `name:`.
   */
  active: number | string;
  /** A `#set` rule, where only settable parameters apply. */
  isSet: boolean;
}

/**
 * Longest stretch of text we will re-scan for one cursor position. The tooltip
 * recomputes on every cursor move, so this is a latency bound as much as a
 * correctness one.
 */
const MAX_SCAN = 4000;

/** Frame for one open delimiter. Calls carry the argument state; groups just nest. */
interface Frame {
  /** `)`, `]` or `}` — the delimiter that closes this frame. */
  close: string;
  /** Set when this frame is a function call's argument list. */
  call?: {
    callee: string;
    isSet: boolean;
    /** Positional index of the argument being written. */
    index: number;
    /** Name of the named argument being written, once `name:` has been typed. */
    named: string | null;
    /** Offset where the current argument segment starts, for key detection. */
    segmentStart: number;
  };
  /**
   * The most recently closed direct child group and its LaTeX argument index,
   * so `\frac{a}{b}` can tell that the second `{` continues the same command.
   */
  lastChild?: { callee: string; index: number; end: number };
}

/**
 * Pick a safe place to start scanning: a paragraph break if one is close
 * enough, otherwise a hard budget back from the cursor. A blank line cannot
 * occur inside a Typst string or a LaTeX argument, which makes it a reliable
 * point to assume "no delimiters are open".
 */
function scanStart(text: string, position: number): number {
  const floor = Math.max(0, position - MAX_SCAN);
  const blank = text.lastIndexOf('\n\n', position);
  return blank > floor ? blank + 2 : floor;
}

const IDENT_BEFORE_PAREN = /(?:^|[^\w.-])(#?)([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)$/;
const IDENT = /^[A-Za-z_][\w-]*$/;

/**
 * Longest identifier (plus dots) we look back over to find a callee, and the
 * longest keyword run before it. Matching against a slice of this size rather
 * than `text.slice(0, i)` keeps delimiter handling O(1) per character instead of
 * O(n), which matters because a document full of open parens would otherwise be
 * quadratic.
 */
const LOOKBEHIND = 96;

/**
 * Resolve the callee immediately left of an opening paren.
 *
 * Returns null when the paren is not a call — an array or dictionary
 * (`(1fr, 2fr)`), a grouped expression, or a `#let` parameter *definition*
 * (`#let f(a, b) = ..`), where the parens declare parameters rather than pass
 * arguments and a signature tooltip would be actively misleading.
 */
function calleeBefore(text: string, parenIndex: number): { callee: string; isSet: boolean } | null {
  const from = Math.max(0, parenIndex - LOOKBEHIND);
  const window = text.slice(from, parenIndex);
  const match = IDENT_BEFORE_PAREN.exec(window);
  if (!match) return null;
  const callee = match[2];

  // What precedes the identifier decides whether this is a call at all.
  const head = window.slice(0, window.length - callee.length - match[1].length);
  const keyword = /(?:^|[^\w-])#?(let|set|show|import)\s+$/.exec(head);
  if (keyword) {
    const which = keyword[1];
    // `#let f(..)` declares parameters; `#import`/`#show` are not calls either.
    if (which !== 'set') return null;
    return { callee, isSet: true };
  }
  return { callee, isSet: false };
}

/** Scan Typst code, returning the innermost enclosing call at `position`. */
function typstCallSite(text: string, position: number): CallSite | null {
  const from = scanStart(text, position);
  const stack: Frame[] = [];

  for (let i = from; i < position; i++) {
    const ch = text[i];

    // Comments and strings first: their contents must not reach the stack.
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? position : nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1 || end + 2 > position) return innermostCall(stack);
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < position) {
        if (text[j] === '\\') j += 2;
        else if (text[j] === '"') break;
        else j++;
      }
      // An unterminated string swallows the rest: the cursor is inside a literal,
      // so the enclosing call is still the answer, just with no new state.
      if (j >= position) return innermostCall(stack);
      i = j;
      continue;
    }

    if (ch === '(') {
      const call = calleeBefore(text, i);
      stack.push({
        close: ')',
        call: call
          ? { callee: call.callee, isSet: call.isSet, index: 0, named: null, segmentStart: i + 1 }
          : undefined,
      });
      continue;
    }
    // Content and code blocks nest independently; commas inside them belong to
    // whatever is in the block, not to the enclosing call's argument list.
    if (ch === '[') { stack.push({ close: ']' }); continue; }
    if (ch === '{') { stack.push({ close: '}' }); continue; }

    if (ch === ')' || ch === ']' || ch === '}') {
      // Only pop on a match: a stray closer means our start point was mid-
      // expression, and unwinding a frame we never pushed would be worse.
      if (stack.length && stack[stack.length - 1].close === ch) stack.pop();
      continue;
    }

    const top = stack[stack.length - 1];
    if (!top?.call) continue;

    if (ch === ',') {
      top.call.index++;
      top.call.named = null;
      top.call.segmentStart = i + 1;
      continue;
    }
    if (ch === ':') {
      // A key only counts at the start of an argument segment, which is what
      // distinguishes `caption:` from a colon inside an expression.
      const key = text.slice(top.call.segmentStart, i).trim();
      if (IDENT.test(key)) top.call.named = key;
      continue;
    }
  }

  return innermostCall(stack);
}

/** Topmost frame that is a call, so nested calls resolve to the inner one. */
function innermostCall(stack: readonly Frame[]): CallSite | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (frame.call) {
      return {
        callee: frame.call.callee,
        active: frame.call.named ?? frame.call.index,
        isSet: frame.call.isSet,
      };
    }
  }
  return null;
}

// A command may be separated from its first argument by blanks and at most one
// newline, matching `isAdjacent`. Two newlines end the paragraph, and a comment
// consumes to end-of-line, so `\frac{a}% junk\n{b}` must resolve `{b}` as a
// sibling group rather than as `\frac`'s first argument.
const LATEX_COMMAND_BEFORE = /\\([A-Za-z@]+\*?)[ \t]*\n?[ \t]*$/;

/**
 * Scan LaTeX, returning the innermost enclosing argument group.
 *
 * LaTeX has no argument separators: `\frac{a}{b}` is two adjacent groups, so the
 * argument index comes from counting sibling groups rather than commas. A group
 * continues the preceding command when it opens immediately after that
 * command's previous group closed.
 */
function latexCallSite(text: string, position: number): CallSite | null {
  const from = scanStart(text, position);
  const stack: Frame[] = [];
  // The most recent group closed at depth zero, so `\frac{a}{` is recognised
  // even though `{a}` closed with an empty stack. Local, not module state.
  let lastTopLevel: Frame['lastChild'];

  for (let i = from; i < position; i++) {
    const ch = text[i];

    if (ch === '\\') { i++; continue; }          // escaped char, incl. `\{` and `\%`
    if (ch === '%') {                            // comment to end of line
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? position : nl;
      continue;
    }

    if (ch === '{' || ch === '[') {
      const close = ch === '{' ? '}' : ']';
      const parent = stack[stack.length - 1];
      // Bounded lookbehind: see LOOKBEHIND. Slicing to `i` would be O(n) here.
      const command = LATEX_COMMAND_BEFORE.exec(
        text.slice(Math.max(0, i - LOOKBEHIND), i),
      );
      const sibling = parent ? parent.lastChild : lastTopLevel;
      let call: Frame['call'];

      if (command) {
        // First argument of a command: the `{` in `\frac{`.
        call = { callee: command[1], isSet: false, index: 0, named: null, segmentStart: i + 1 };
      } else if (sibling && isAdjacent(text, sibling.end, i)) {
        // A further argument of the same command: the `{b}` in `\frac{a}{b}`.
        call = {
          callee: sibling.callee,
          isSet: false,
          index: sibling.index + 1,
          named: null,
          segmentStart: i + 1,
        };
      }

      stack.push({ close, call });
      continue;
    }

    if (ch === '}' || ch === ']') {
      const top = stack[stack.length - 1];
      if (!top || top.close !== ch) continue;
      stack.pop();
      if (top.call) {
        const record = { callee: top.call.callee, index: top.call.index, end: i };
        const parent = stack[stack.length - 1];
        if (parent) parent.lastChild = record;
        else lastTopLevel = record;
      }
      continue;
    }
  }

  return innermostCall(stack);
}

/**
 * Sibling argument groups may be separated by whitespace and comments but
 * nothing else: `\frac{a} {b}` is still two arguments of `\frac`, while
 * `\frac{a} x {b}` is not.
 *
 * A `%` comment counts as a separator because TeX itself discards it — the
 * idiom `\frac{a}% keep the line short\n{b}` is one command with two arguments.
 * A blank line still breaks the run, since that ends the paragraph.
 */
function isAdjacent(text: string, closeIndex: number, openIndex: number): boolean {
  const between = text.slice(closeIndex + 1, openIndex);
  // Drop comment runs (`%` to end of line, including the newline) before
  // checking, so only real whitespace has to pass the test below.
  const stripped = between.replace(/%[^\n]*\n?/g, '');
  return /^[ \t]*\n?[ \t]*$/.test(stripped);
}

/**
 * Which call encloses `position`, and which parameter is being written.
 *
 * Returns null when the cursor is not inside a call's arguments, which is the
 * common case — the caller shows no tooltip then.
 */
export function detectCallSite(text: string, position: number, language: Lang): CallSite | null {
  if (position < 0 || position > text.length) return null;
  if (language === 'typst') return typstCallSite(text, position);
  if (language === 'latex') return latexCallSite(text, position);
  return null;
}
