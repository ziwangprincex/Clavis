import { describe, expect, it } from 'vitest';
import { detectMathContext } from './mathContext';

/** Convenience: detect at the end of `text`. */
function at(text: string) {
  return detectMathContext(text, text.length);
}

describe('inline math delimiters', () => {
  it('detects inside $...$', () => {
    expect(at('Let $x^2').math).toBe(true);
  });

  it('detects outside a closed $...$', () => {
    expect(at('Let $x^2$ and then ').math).toBe(false);
  });

  it('detects inside $$...$$', () => {
    expect(at('Display: $$\\int_0^1 ').math).toBe(true);
  });

  it('detects outside a closed $$...$$', () => {
    expect(at('$$x$$ prose ').math).toBe(false);
  });

  it('detects inside \\(...\\)', () => {
    expect(at('inline \\(a+b').math).toBe(true);
  });

  it('detects outside a closed \\(...\\)', () => {
    expect(at('inline \\(a+b\\) done ').math).toBe(false);
  });

  it('detects inside \\[...\\]', () => {
    expect(at('display \\[E=mc^2').math).toBe(true);
  });

  it('detects outside a closed \\[...\\]', () => {
    expect(at('display \\[E=mc^2\\] after ').math).toBe(false);
  });
});

describe('escaping and comments', () => {
  it('does not treat \\$ as a delimiter', () => {
    // A price, not math. Getting this wrong flips the rest of the line.
    expect(at('costs \\$5 and ').math).toBe(false);
  });

  it('ignores a $ inside a comment', () => {
    expect(at('% price is $5\nprose ').math).toBe(false);
  });

  it('still honours a real $ after a commented one', () => {
    expect(at('% $ ignored\nLet $x').math).toBe(true);
  });

  it('treats \\% as text, not a comment', () => {
    expect(at('50\\% of $x').math).toBe(true);
  });
});

describe('math environments', () => {
  it('detects inside equation', () => {
    expect(at('\\begin{equation}\n  a=b').math).toBe(true);
  });

  it('detects inside starred variants', () => {
    expect(at('\\begin{align*}\n  a &= b').math).toBe(true);
  });

  it('detects outside a closed environment', () => {
    expect(at('\\begin{align}\na\n\\end{align}\nprose ').math).toBe(false);
  });

  it('does not treat prose environments as math', () => {
    expect(at('\\begin{itemize}\n  \\item ').math).toBe(false);
  });

  it('reports the enclosing environment stack, nearest first', () => {
    const ctx = at('\\begin{figure}\n\\begin{center}\n');
    expect(ctx.envs).toEqual(['center', 'figure']);
  });

  it('handles nested math environments', () => {
    expect(at('\\begin{equation}\n\\begin{pmatrix}\n1 & 2').math).toBe(true);
  });
});

describe('text islands inside math', () => {
  it('returns to text mode inside \\text{}', () => {
    expect(at('$x = 1 \\text{ where ').math).toBe(false);
  });

  it('returns to math after \\text{} closes', () => {
    expect(at('$x = 1 \\text{ where } y').math).toBe(true);
  });

  it('handles braces nested inside \\text{}', () => {
    expect(at('$a \\text{see \\emph{this} note ').math).toBe(false);
  });
});

describe('bounded scanning', () => {
  it('treats a blank line as a math terminator', () => {
    // TeX forbids a blank line inside $...$, so an unclosed $ cannot leak past
    // one. This is what keeps the scan cheap.
    expect(at('$unclosed\n\nnew paragraph ').math).toBe(false);
  });

  it('does not let preamble math leak past \\begin{document}', () => {
    expect(at('$stray\n\\begin{document}\nprose ').math).toBe(false);
  });

  it('stays correct in a large document', () => {
    const filler = 'Some prose line.\n'.repeat(3000);
    expect(at(`${filler}Let $x^2`).math).toBe(true);
    expect(at(`${filler}plain text `).math).toBe(false);
  });

  it('runs fast enough for the keystroke path', () => {
    // Guards the bounded-scan design: an unbounded implementation would grow
    // with document size and stall typing in a long file. The threshold is loose
    // because CI machines are noisy — the failure this catches is asymptotic
    // (tens of ms per call), not a few hundred microseconds of jitter.
    const doc = `${'Paragraph of prose here.\n'.repeat(20_000)}Let $x^2`;
    detectMathContext(doc, doc.length); // Warm up, ignore first-call cost.
    const started = performance.now();
    for (let i = 0; i < 50; i++) detectMathContext(doc, doc.length);
    const perCall = (performance.now() - started) / 50;
    expect(perCall).toBeLessThan(20);
  });
});

describe('edge cases', () => {
  it('handles an empty document', () => {
    expect(detectMathContext('', 0)).toEqual({ math: false, envs: [] });
  });

  it('respects the given position, not the document end', () => {
    const text = 'a $b$ c';
    expect(detectMathContext(text, 4).math).toBe(true);  // inside $b$
    expect(detectMathContext(text, 7).math).toBe(false); // after it
  });

  it('does not crash on unbalanced \\end', () => {
    expect(at('\\end{align}\nprose ').math).toBe(false);
  });
});
