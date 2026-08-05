// `#let` parameter-list parsing tests.
//
// The interesting cases are all about default values: a default can contain the
// same characters the parser splits on, so naive `split(',')` mis-parses.

import { beforeEach, describe, expect, it } from 'vitest';
import { letFunctionsFor, resetLetCacheForTests, scanLetFunctions } from './typstLetScan';

beforeEach(() => {
  resetLetCacheForTests();
});

describe('scanLetFunctions', () => {
  it('reads a simple parameter list', () => {
    expect(scanLetFunctions('#let greet(name, punct) = []')).toEqual([
      {
        name: 'greet',
        params: [
          { name: 'name', default: null, variadic: false },
          { name: 'punct', default: null, variadic: false },
        ],
      },
    ]);
  });

  it('records default values', () => {
    const [fn] = scanLetFunctions('#let box(width: 1cm, fill: none) = []');
    expect(fn.params).toEqual([
      { name: 'width', default: '1cm', variadic: false },
      { name: 'fill', default: 'none', variadic: false },
    ]);
  });

  it('marks a spread parameter as variadic', () => {
    const [fn] = scanLetFunctions('#let row(label, ..cells) = []');
    expect(fn.params[1]).toEqual({ name: 'cells', default: null, variadic: true });
  });

  it('accepts an unnamed spread', () => {
    const [fn] = scanLetFunctions('#let ignore(a, ..) = []');
    expect(fn.params[1]).toMatchObject({ variadic: true });
  });

  it('takes no parameters without complaint', () => {
    expect(scanLetFunctions('#let stamp() = []')).toEqual([{ name: 'stamp', params: [] }]);
  });

  it('skips plain value bindings', () => {
    // `#let x = 1` is not a function, so it must not appear.
    expect(scanLetFunctions('#let x = 1\n#let f(a) = []')).toEqual([
      { name: 'f', params: [{ name: 'a', default: null, variadic: false }] },
    ]);
  });

  it('finds several definitions', () => {
    expect(scanLetFunctions('#let a(x) = []\n#let b(y) = []').map(f => f.name)).toEqual(['a', 'b']);
  });

  it('handles hyphenated names', () => {
    expect(scanLetFunctions('#let my-func(a) = []')[0].name).toBe('my-func');
  });

  describe('defaults that contain the split characters', () => {
    it('does not split inside a parenthesised default', () => {
      const [fn] = scanLetFunctions('#let f(a: (1, 2), b: 3) = []');
      expect(fn.params).toEqual([
        { name: 'a', default: '(1, 2)', variadic: false },
        { name: 'b', default: '3', variadic: false },
      ]);
    });

    it('does not split inside a string default', () => {
      const [fn] = scanLetFunctions('#let f(sep: "a, b", n: 1) = []');
      expect(fn.params).toEqual([
        { name: 'sep', default: '"a, b"', variadic: false },
        { name: 'n', default: '1', variadic: false },
      ]);
    });

    it('does not split inside a content-block default', () => {
      const [fn] = scanLetFunctions('#let f(body: [x, y], n: 2) = []');
      expect(fn.params.map(p => p.name)).toEqual(['body', 'n']);
      expect(fn.params[0].default).toBe('[x, y]');
    });

    it('does not end the list on a nested closing paren', () => {
      const [fn] = scanLetFunctions('#let f(a: calc.max(1, 2), b: 3) = []');
      expect(fn.params.map(p => p.name)).toEqual(['a', 'b']);
      expect(fn.params[0].default).toBe('calc.max(1, 2)');
    });

    it('handles an escaped quote in a string default', () => {
      const [fn] = scanLetFunctions('#let f(q: "say \\"hi\\", ok", n: 1) = []');
      expect(fn.params.map(p => p.name)).toEqual(['q', 'n']);
    });
  });

  describe('malformed input stays bounded', () => {
    it('skips an unterminated parameter list', () => {
      expect(scanLetFunctions('#let broken(a, b')).toEqual([]);
    });

    it('does not hang on a long unclosed list', () => {
      const text = `#let broken(${'a, '.repeat(50_000)}`;
      const started = Date.now();
      expect(scanLetFunctions(text)).toEqual([]);
      expect(Date.now() - started).toBeLessThan(200);
    });

    it('still finds a later valid definition after a broken one', () => {
      const result = scanLetFunctions('#let broken(a, b\n#let ok(c) = []');
      expect(result.map(f => f.name)).toContain('ok');
    });
  });
});

describe('letFunctionsFor', () => {
  it('indexes definitions by name', () => {
    const index = letFunctionsFor('#let f(a) = []\n#let g(b) = []');
    expect([...index.keys()].sort()).toEqual(['f', 'g']);
    expect(index.get('f')?.params[0].name).toBe('a');
  });

  it('lets a later definition shadow an earlier one', () => {
    const index = letFunctionsFor('#let f(old) = []\n#let f(new-name) = []');
    expect(index.get('f')?.params[0].name).toBe('new-name');
  });

  it('returns the same object for repeated calls on identical text', () => {
    // The tooltip asks on every cursor move; re-parsing each time would be waste.
    const text = '#let f(a) = []';
    expect(letFunctionsFor(text)).toBe(letFunctionsFor(text));
  });

  it('re-parses when the document changes', () => {
    expect(letFunctionsFor('#let f(a) = []').get('f')?.params[0].name).toBe('a');
    expect(letFunctionsFor('#let f(b) = []').get('f')?.params[0].name).toBe('b');
  });
});
