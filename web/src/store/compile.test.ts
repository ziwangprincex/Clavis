import { describe, expect, it } from 'vitest';
import { describeChain, headlineProblem } from './compile';

const passes = (count: number) => `${count} pass${count === 1 ? '' : 'es'}`;

describe('build chain', () => {
  it('names the engine, the bibliography tool and the passes', () => {
    expect(describeChain({ engine: 'xelatex', bibTool: 'biber', runs: 3 }, passes)).toBe('XeLaTeX · Biber · 3 passes');
    expect(describeChain({ engine: 'pdflatex', bibTool: null, runs: 1 }, passes)).toBe('pdfLaTeX · 1 pass');
    // latexmk decides its own passes.
    expect(describeChain({ engine: 'latexmk', bibTool: null, runs: 1 }, passes)).toBe('latexmk');
  });

  it('headlines the first error rather than an earlier warning', () => {
    expect(headlineProblem([
      { line: 1, message: 'Overfull', kind: 'warning' },
      { line: 2, message: 'Undefined control sequence', kind: 'error' },
    ] as never)).toBe('Undefined control sequence');
  });
});
