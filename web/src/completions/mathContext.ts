/**
 * Math-mode detection for LaTeX documents.
 *
 * Needed to honour the `.cwl` corpus's `#m` (math-only) and `#n` (text-only)
 * classifiers: `\sqrt` is meaningless in prose, `\textbf` is meaningless inside
 * `$...$`, and the corpus records which is which. Without this the popup offers
 * every command everywhere, which is most of what makes completion feel wrong.
 *
 * This is hand-rolled rather than read off the syntax tree because CodeMirror's
 * stex mode cannot supply it: stex *does* track math mode internally
 * (`inMathMode`), but the state lives in a closure function pointer (`state.f`)
 * that the syntax tree does not expose, and both modes emit the same `tag` token
 * for commands. Its `stexMath` export treats the whole document as math, which
 * does not apply to mixed files.
 *
 * Two constraints shape the implementation:
 *
 *   - **Bounded.** This runs per keystroke. Scanning from the top of the document
 *     each time is the redundant-rescan cost that has bitten this module before,
 *     so the scan starts from a nearby anchor and walks forward only.
 *   - **Biased toward text.** When the answer is unclear we report text mode.
 *     A false "math" verdict hides `\textbf` and friends, which is far more
 *     disruptive than showing a few extra math commands in prose.
 */

/** Environments whose bodies are math mode. */
const MATH_ENVIRONMENTS = new Set([
  'math', 'displaymath', 'equation', 'eqnarray', 'align', 'alignat', 'flalign',
  'gather', 'multline', 'split', 'aligned', 'alignedat', 'gathered', 'cases',
  'array', 'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix',
  'smallmatrix', 'subequations', 'dcases', 'rcases', 'IEEEeqnarray',
]);

/**
 * How far back the scan may look for its starting point.
 *
 * Display math spanning more than this is pathological; a document with an
 * unclosed `$` earlier would otherwise force a full-document walk on every
 * keystroke.
 */
const MAX_LOOKBACK_LINES = 500;

export interface MathContext {
  /** Whether the position sits inside math mode. */
  math: boolean;
  /** Innermost enclosing environments, nearest first. */
  envs: string[];
}

/**
 * Strip a `%` comment from one line, respecting `\%`.
 *
 * Comments must not influence the verdict: a commented-out `$` would otherwise
 * flip the rest of the document into math mode.
 */
function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '%') continue;
    let slashes = 0;
    for (let c = i - 1; c >= 0 && line[c] === '\\'; c--) slashes++;
    if (slashes % 2 === 0) return line.slice(0, i);
  }
  return line;
}

/**
 * Choose a line to start scanning from.
 *
 * Anything that reliably terminates math is a safe anchor. A blank line is the
 * strongest: TeX itself forbids a blank line inside `$...$`, so math cannot span
 * one. `\begin{document}` and `\end{<math env>}` are equally safe. Falling back
 * to the lookback ceiling keeps the cost bounded even in a document with no
 * anchor at all.
 */
function scanStartLine(lines: string[], cursorLine: number): number {
  const floor = Math.max(0, cursorLine - MAX_LOOKBACK_LINES);
  for (let i = cursorLine - 1; i >= floor; i--) {
    const line = stripComment(lines[i]);
    if (line.trim() === '') return i + 1;
    if (line.includes('\\begin{document}')) return i + 1;
    const endMatch = /\\end\s*\{([^{}]+)\}/.exec(line);
    if (endMatch && MATH_ENVIRONMENTS.has(endMatch[1].replace(/\*$/, ''))) return i + 1;
  }
  return floor;
}

/**
 * Determine whether `position` in `text` is in math mode.
 *
 * Recognises `$...$`, `$$...$$`, `\(...\)`, `\[...\]`, and math environments,
 * including starred forms. `\text{...}` and `\mbox{...}` inside math return to
 * text mode, since that is their entire purpose.
 */
export function detectMathContext(text: string, position: number): MathContext {
  const before = text.slice(0, position);
  const lines = before.split('\n');
  const cursorLine = lines.length - 1;
  const start = scanStartLine(lines, cursorLine);

  // Rebuild the scan window with comments removed, preserving line structure so
  // offsets stay meaningful.
  const window = lines.slice(start).map(stripComment).join('\n');

  let inDollar = false;        // $...$
  let inDoubleDollar = false;  // $$...$$
  let inParen = false;         // \(...\)
  let inBracket = false;       // \[...\]
  const envStack: string[] = [];
  // Depth of `\text{...}`-style escapes back into text mode, and the env-stack
  // depth each was opened at, so a stray `}` cannot unbalance the tracking.
  let textEscapeBraces = 0;
  let inTextEscape = false;

  for (let i = 0; i < window.length; i++) {
    const ch = window[i];

    if (ch === '\\') {
      const next = window[i + 1];
      // Escaped literals (`\$`, `\%`, `\\`) never open or close anything.
      if (next && !/[A-Za-z]/.test(next)) {
        if (next === '(') { inParen = true; i++; continue; }
        if (next === ')') { inParen = false; i++; continue; }
        if (next === '[') { inBracket = true; i++; continue; }
        if (next === ']') { inBracket = false; i++; continue; }
        i++; // Consume the escaped character.
        continue;
      }

      const command = /^\\([A-Za-z@]+)\*?/.exec(window.slice(i));
      if (!command) continue;
      const name = command[1];

      if (name === 'begin' || name === 'end') {
        const env = /^\\(?:begin|end)\s*\{([^{}]+)\}/.exec(window.slice(i));
        if (env) {
          const envName = env[1].replace(/\*$/, '');
          if (name === 'begin') envStack.push(envName);
          else {
            const at = envStack.lastIndexOf(envName);
            if (at >= 0) envStack.splice(at, 1);
          }
          i += env[0].length - 1;
          continue;
        }
      }

      // `\text{...}` and friends are text islands inside math.
      if ((name === 'text' || name === 'mbox' || name === 'textrm' || name === 'intertext')
          && window[i + command[0].length] === '{') {
        inTextEscape = true;
        textEscapeBraces = 0;
        i += command[0].length; // Land on the `{`, counted below.
        textEscapeBraces = 1;
        continue;
      }

      i += command[0].length - 1;
      continue;
    }

    if (inTextEscape) {
      if (ch === '{') textEscapeBraces++;
      else if (ch === '}') {
        textEscapeBraces--;
        if (textEscapeBraces <= 0) inTextEscape = false;
      }
      continue; // Delimiters inside a text island do not toggle math.
    }

    if (ch === '$') {
      if (window[i + 1] === '$') {
        inDoubleDollar = !inDoubleDollar;
        i++;
      } else {
        inDollar = !inDollar;
      }
    }
  }

  const inMathEnv = envStack.some(env => MATH_ENVIRONMENTS.has(env));
  return {
    math: !inTextEscape && (inDollar || inDoubleDollar || inParen || inBracket || inMathEnv),
    envs: [...envStack].reverse(),
  };
}
