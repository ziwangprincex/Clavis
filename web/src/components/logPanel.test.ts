import { describe, expect, it } from 'vitest';
import { logLineFor } from './LogPanel';

const line = (text: string, run = 1) => ({ run, stream: 'stdout' as const, text });

describe('problem → raw output', () => {
  it('finds the last line carrying the problem, from the final pass', () => {
    const lines = [
      line('! Undefined control sequence.', 1),
      line('l.12 \\foo', 1),
      line('! Undefined control sequence.', 2),
      line('Output written on main.pdf', 2),
    ];
    expect(logLineFor(lines, 'Undefined control sequence.')).toBe(2);
    expect(logLineFor(lines, '! Undefined control sequence.\nl.12 \\foo')).toBe(2);
    expect(logLineFor(lines, 'Something else')).toBe(-1);
    expect(logLineFor(lines, '')).toBe(-1);
  });
});
