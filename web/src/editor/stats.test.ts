import { describe, it, expect } from 'vitest';
import { computeStats, countChars, countLines, countWords } from './stats';

describe('countLines', () => {
  it('returns 1 for empty string (a blank doc still shows Ln 1)', () => {
    expect(countLines('')).toBe(1);
  });
  it('counts \\n and adds 1', () => {
    expect(countLines('a')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\n')).toBe(3); // trailing newline creates a phantom line
  });
});

describe('countWords', () => {
  it('is 0 for empty and whitespace-only', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t  ')).toBe(0);
  });
  it('splits on any whitespace run', () => {
    expect(countWords('one')).toBe(1);
    expect(countWords('one two')).toBe(2);
    expect(countWords('  one\ttwo\n\nthree ')).toBe(3);
  });
  it('treats hyphenated tokens as one word', () => {
    expect(countWords('well-known thing')).toBe(2);
  });
});

describe('countChars', () => {
  it('returns JS string length (matches VS Code)', () => {
    expect(countChars('')).toBe(0);
    expect(countChars('abc')).toBe(3);
    expect(countChars('a\nb')).toBe(3);
  });
});

describe('computeStats', () => {
  it('bundles the three counts', () => {
    expect(computeStats('hello world\nsecond line')).toEqual({
      words: 4,
      chars: 23,
      lines: 2,
    });
  });
});
