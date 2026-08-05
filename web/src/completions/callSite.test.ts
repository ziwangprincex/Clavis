// Call-site detection tests.
//
// The hard part is not "am I inside parens" but which call and which parameter.
// The cases that matter are the ones where a naive comma count gets it wrong:
// commas inside strings, dictionaries, content blocks, and nested calls.

import { describe, expect, it } from 'vitest';
import { detectCallSite } from './callSite';

/** Cursor at end of `text`, which is where a user typing actually is. */
function at(text: string, language: 'typst' | 'latex' = 'typst') {
  return detectCallSite(text, text.length, language);
}

describe('typst call sites', () => {
  it('finds the callee and first positional parameter', () => {
    expect(at('#figure(')).toEqual({ callee: 'figure', active: 0, isSet: false });
  });

  it('counts positional arguments by comma', () => {
    expect(at('#grid(1fr, 2fr, ')).toMatchObject({ callee: 'grid', active: 2 });
  });

  it('switches to the named parameter once a key is typed', () => {
    expect(at('#figure(img, caption: ')).toMatchObject({ callee: 'figure', active: 'caption' });
  });

  it('resolves to the innermost call when calls nest', () => {
    // The outer `figure(` is still open, but the cursor belongs to `image(`.
    expect(at('#figure(image(')).toMatchObject({ callee: 'image', active: 0 });
  });

  it('returns to the outer call after an inner one closes', () => {
    expect(at('#figure(image("a.png"), ')).toMatchObject({ callee: 'figure', active: 1 });
  });

  it('recognises a set rule and flags it', () => {
    expect(at('#set text(')).toEqual({ callee: 'text', active: 0, isSet: true });
  });

  it('handles dotted callees', () => {
    expect(at('#calc.pow(2, ')).toMatchObject({ callee: 'calc.pow', active: 1 });
  });

  it('is null outside any call', () => {
    expect(at('Some prose here')).toBeNull();
    expect(at('#figure(x) after')).toBeNull();
  });

  describe('commas that must not be counted', () => {
    it('ignores commas inside a string literal', () => {
      expect(at('#figure(image("a, b, c"), ')).toMatchObject({ callee: 'figure', active: 1 });
    });

    it('ignores an escaped quote inside a string', () => {
      // The `\"` must not end the literal early, so the comma after it is still
      // inside the string and the argument index stays 0.
      expect(at('#figure("say \\"a, b\\" now, ')).toMatchObject({
        callee: 'figure',
        active: 0,
      });
    });

    it('ignores commas inside a dictionary or array argument', () => {
      // `(1fr, 2fr)` is one argument; the tuple's commas belong to it.
      expect(at('#grid(columns: (1fr, 2fr), ')).toMatchObject({ callee: 'grid', active: 1 });
    });

    it('ignores commas inside a content block', () => {
      expect(at('#figure([a, b, c], ')).toMatchObject({ callee: 'figure', active: 1 });
    });

    it('ignores commas inside a code block', () => {
      expect(at('#figure({ let x = (1, 2) }, ')).toMatchObject({ callee: 'figure', active: 1 });
    });

    it('ignores commas in a line comment', () => {
      expect(at('#figure(a, // b, c\n')).toMatchObject({ callee: 'figure', active: 1 });
    });

    it('ignores commas in a block comment', () => {
      expect(at('#figure(a, /* b, c */ ')).toMatchObject({ callee: 'figure', active: 1 });
    });
  });

  describe('colons that are not parameter keys', () => {
    it('does not treat a colon inside an expression as a key', () => {
      // The key must be a bare identifier filling the whole segment.
      expect(at('#grid(a.b: ')).toMatchObject({ active: 0 });
    });

    it('resets the named parameter at the next comma', () => {
      expect(at('#figure(caption: x, ')).toMatchObject({ active: 1 });
    });
  });

  describe('parens that are not calls', () => {
    it('ignores a bare grouping paren', () => {
      expect(at('#let x = (1, ')).toBeNull();
    });

    it('does not treat a #let parameter list as a call', () => {
      // These parens *declare* parameters; showing a signature would be wrong.
      expect(at('#let myfunc(a, ')).toBeNull();
    });

    it('does not treat #import as a call', () => {
      expect(at('#import calc(')).toBeNull();
    });
  });
});

describe('latex call sites', () => {
  it('finds a command and its first argument', () => {
    expect(at('\\frac{', 'latex')).toMatchObject({ callee: 'frac', active: 0 });
  });

  it('counts the second brace group as the second argument', () => {
    expect(at('\\frac{a}{', 'latex')).toMatchObject({ callee: 'frac', active: 1 });
  });

  it('resolves to the inner command when groups nest', () => {
    expect(at('\\frac{\\sqrt{', 'latex')).toMatchObject({ callee: 'sqrt', active: 0 });
  });

  it('continues the outer command after an inner group closes', () => {
    expect(at('\\frac{\\sqrt{x}}{', 'latex')).toMatchObject({ callee: 'frac', active: 1 });
  });

  it('treats an optional argument as the command first argument', () => {
    expect(at('\\includegraphics[', 'latex')).toMatchObject({ callee: 'includegraphics' });
  });

  it('counts the mandatory group after an optional one', () => {
    expect(at('\\includegraphics[w=1]{', 'latex')).toMatchObject({
      callee: 'includegraphics',
      active: 1,
    });
  });

  it('allows whitespace between argument groups', () => {
    expect(at('\\frac{a} {', 'latex')).toMatchObject({ callee: 'frac', active: 1 });
  });

  it('does not join groups separated by other text', () => {
    // `{b}` here is not an argument of `\frac`.
    expect(at('\\frac{a} x {', 'latex')).toBeNull();
  });

  it('ignores a percent comment', () => {
    expect(at('\\frac{a}% }{\n{', 'latex')).toMatchObject({ callee: 'frac', active: 1 });
  });

  it('ignores an escaped brace', () => {
    expect(at('\\frac{\\{a\\}}{', 'latex')).toMatchObject({ callee: 'frac', active: 1 });
  });

  it('is null in plain prose', () => {
    expect(at('just some text', 'latex')).toBeNull();
  });
});

describe('unclosed delimiters must stay bounded', () => {
  // The predecessor bug: an unbounded regex let one unclosed `[` claim the rest
  // of the document and silently kill the completion popup. Every scan here
  // starts from a blank line or a hard character budget, so a stray delimiter
  // cannot reach across a paragraph break.

  it('does not carry an unclosed typst paren past a blank line', () => {
    const text = '#figure(\n\nA new paragraph, still typing ';
    expect(at(text)).toBeNull();
  });

  it('does not carry an unclosed latex brace past a blank line', () => {
    const text = '\\frac{\n\nA new paragraph, still typing ';
    expect(at(text, 'latex')).toBeNull();
  });

  it('bounds the scan on a pathological run of open delimiters', () => {
    // 50k unclosed parens with no blank line: must terminate quickly and not
    // walk the whole document.
    const text = `${'('.repeat(50_000)}#figure(`;
    const started = Date.now();
    expect(at(text)).toMatchObject({ callee: 'figure' });
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('handles an unterminated string without losing the enclosing call', () => {
    expect(at('#figure("unterminated, ')).toMatchObject({ callee: 'figure' });
  });
});
