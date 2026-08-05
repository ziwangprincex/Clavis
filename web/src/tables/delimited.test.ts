import { describe, expect, it } from 'vitest';
import { parseDelimitedTable, renderTable } from './delimited';

describe('delimited academic table conversion', () => {
  it('parses quoted CSV commas and normalizes ragged rows', () => {
    const table = parseDelimitedTable('Name,Value\n"Smith, John",1\nDoe');
    expect(table.rows).toEqual([['Name', 'Value'], ['Smith, John', '1'], ['Doe', '']]);
  });

  it('parses TSV and preserves quoted newlines', () => {
    const table = parseDelimitedTable('A\tB\n"line 1\nline 2"\tvalue');
    expect(table.delimiter).toBe('\t');
    expect(table.rows[1][0]).toBe('line 1\nline 2');
  });

  it('renders correct native syntax in all three formats', () => {
    const table = parseDelimitedTable('Variable,Estimate\nMinimum wage,0.12');
    expect(renderTable(table, { format: 'markdown', hasHeader: true })).toContain('| Variable | Estimate |');
    const latex = renderTable(table, { format: 'latex', hasHeader: true });
    expect(latex).toContain('\\toprule');
    expect(latex).toContain('Minimum wage & 0.12 \\\\');
    const typst = renderTable(table, { format: 'typst', hasHeader: true });
    expect(typst).toContain('#table(');
    expect(typst).toContain('table.header(text("Variable"), text("Estimate"))');
  });

  it('escapes Markdown pipes and LaTeX special characters', () => {
    const table = parseDelimitedTable('A\n50% | #');
    expect(renderTable(table, { format: 'markdown', hasHeader: false })).toContain('50% \\| #');
    expect(renderTable(table, { format: 'latex', hasHeader: false })).toContain('50\\% | \\#');
  });

  it('rejects malformed quotes', () => {
    expect(() => parseDelimitedTable('"unclosed')).toThrow('Unclosed');
  });
});
