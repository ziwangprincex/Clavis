import { describe, expect, it } from 'vitest';
import { analyzeWriting } from './rules';

describe('local academic writing rules', () => {
  it('finds common prose consistency issues', () => {
    const diagnostics = analyzeWriting('Figure 1 and Fig. 2 use 50 %; p value is reported. Color and colour differ. Gross domestic product (GDP) rises.', 'markdown', 'paper.md');
    expect(diagnostics.map(item => item.code)).toContain('percent-space');
    expect(diagnostics.map(item => item.code)).toContain('p-value-style');
    expect(diagnostics.map(item => item.code)).toContain('figure-style');
    expect(diagnostics.map(item => item.code)).toContain('spelling-variant');
    expect(diagnostics.some(item => item.code === 'undefined-acronym' && item.message.includes('GDP'))).toBe(false);
  });

  it('ignores comments and code-like regions in LaTeX, Typst and Markdown', () => {
    expect(analyzeWriting('% 50 %\n\\begin{verbatim}p value\nABC\n\\end{verbatim}', 'latex', 'a.tex')).toHaveLength(0);
    expect(analyzeWriting('// 50 %\n`p value ABC`', 'typst', 'a.typ')).toHaveLength(0);
    expect(analyzeWriting('`50 % ABC`\n```\np value\n```', 'markdown', 'a.md')).toHaveLength(0);
  });

  it('honors configured spelling style and ignored acronyms', () => {
    const us = analyzeWriting('Colour appears.', 'markdown', 'a.md', { spelling: 'us' });
    expect(us.some(item => item.code === 'spelling-variant' && item.message.includes('colour'))).toBe(true);
    const uk = analyzeWriting('Color appears.', 'markdown', 'a.md', { spelling: 'uk' });
    expect(uk.some(item => item.code === 'spelling-variant' && item.message.includes('color'))).toBe(true);
    expect(analyzeWriting('Colour and color both appear.', 'markdown', 'a.md', { spelling: 'mixed' }).some(item => item.code === 'spelling-variant')).toBe(false);
    const ignored = analyzeWriting('IV rises.', 'markdown', 'a.md', { ignoredAcronyms: ['IV'] });
    expect(ignored.some(item => item.code === 'undefined-acronym')).toBe(false);
  });

  it('warns when an acronym appears before its definition', () => {
    const diagnostics = analyzeWriting('GDP rises. Gross domestic product (GDP) later appears.', 'markdown', 'a.md');
    expect(diagnostics.some(item => item.code === 'undefined-acronym' && item.message.includes('GDP'))).toBe(true);
  });

  it('does not warn when an acronym is defined before use', () => {
    const diagnostics = analyzeWriting('Gross domestic product (GDP) is used. GDP rises.', 'markdown', 'a.md');
    expect(diagnostics.some(item => item.code === 'undefined-acronym' && item.message.includes('GDP'))).toBe(false);
  });
});
