import { describe, expect, it } from 'vitest';
import { foldRange, mathAt, nonProseRanges, proseMask } from './writingSyntax';
import { analyzeWriting } from '../writing/rules';
describe('writing syntax assistance', () => {
  it('keeps prose while masking TeX commands, identifiers, equations and comments', () => {
    const text = '\\section{Colour}\n\\label{color} $ color + ABC $\n\\textbf{Colour} % color\n\\begin{align}color\\end{align}';
    const mask = proseMask(text, 'latex');
    expect(mask.length).toBe(text.length);
    expect(mask.match(/Colour/g)).toHaveLength(2);
    expect(mask).not.toContain('color');
    expect(mask).not.toContain('ABC');
    expect(nonProseRanges(text, 'latex').length).toBeGreaterThan(0);
  });
  it('ignores Typst code, strings, references and math but keeps content', () => {
    const text = '#text(font: "Colour")[Colour] @color $ color $ // color\n`color`';
    const mask = proseMask(text, 'typst');
    expect(mask).toContain('[Colour]');
    expect(mask).not.toContain('color');
  });
  it('detects dollar and display formulas, but not comments or raw code', () => {
    expect(mathAt('before $a+b$ after', 9, 'latex')?.content).toBe('a+b');
    expect(mathAt('\\[a+b\\]', 3, 'latex')?.display).toBe(true);
    expect(mathAt('% $bad$', 4, 'latex')).toBeNull();
    expect(mathAt('`$bad$`', 4, 'typst')).toBeNull();
  });
  it('does not pair a dollar inside a fenced code block with a later formula', () => {
    // Regression: backticks were paired two at a time, so a template literal in
    // a fence split it open and its `${name}` reached the `$$` below; hovering
    // the table in between previewed it all as one garbled formula.
    const text = 'Inline $E=mc^2$.\n\n```js\nreturn `hi, ${name}`;\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n$$\nx^2\n$$\n';
    expect(mathAt(text, text.indexOf('| 1 |'), 'markdown')).toBeNull();
    expect(mathAt(text, text.indexOf('${name}') + 1, 'markdown')).toBeNull();
    expect(mathAt(text, text.indexOf('E=mc'), 'markdown')?.content).toBe('E=mc^2');
    expect(mathAt(text, text.indexOf('x^2'), 'markdown')).toMatchObject({ content: '\nx^2\n', display: true });
  });
  it('keeps a Markdown inline formula inside one paragraph', () => {
    const text = 'It costs $5 today.\n\nTomorrow it costs $6.';
    expect(mathAt(text, text.indexOf('today'), 'markdown')).toBeNull();
    expect(mathAt('Wrapped $a +\nb$ formula', 10, 'markdown')?.content).toBe('a +\nb');
  });
  it('folds a complete section without consuming the next heading', () => {
    const text = '= First\nbody\n== Child\nmore\n= Second\nnext';
    const range = foldRange(text, 0, 'typst');
    expect(range).not.toBeNull();
    expect(text.slice(range!.from, range!.to)).toContain('more');
    expect(text.slice(range!.from, range!.to)).not.toContain('Second');
  });
  it('folds nested environments at the matching outer end', () => {
    const text = '\\begin{itemize}\n\\begin{itemize}\n\\item A\n\\end{itemize}\n\\end{itemize}';
    expect(foldRange(text, 0, 'latex')?.to).toBe(text.lastIndexOf('\\end'));
  });
  it('writing rules only flag prose spelling', () => {
    const results = analyzeWriting('\\label{colour}\n$ colour $\nColour prose', 'latex', null, { spelling: 'us' });
    expect(results.filter(r => r.code === 'spelling-variant')).toHaveLength(1);
    expect(results[0].line).toBe(3);
  });
});
