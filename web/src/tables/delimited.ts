export type TableFormat = 'markdown' | 'latex' | 'typst';

export interface ParsedTable {
  rows: string[][];
  delimiter: ',' | '\t';
}

export interface RenderTableOptions {
  format: TableFormat;
  hasHeader: boolean;
}

const MAX_INPUT_CHARS = 1_000_000;
const MAX_ROWS = 500;
const MAX_COLUMNS = 100;

export function parseDelimitedTable(input: string): ParsedTable {
  if (input.length > MAX_INPUT_CHARS) throw new Error('Table input exceeds 1,000,000 characters.');
  const delimiter: ',' | '\t' = input.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { value += '"'; index += 1; }
        else quoted = false;
      } else value += char;
      continue;
    }
    if (char === '"' && value.length === 0) { quoted = true; continue; }
    if (char === delimiter) { row.push(value.trim()); value = ''; continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(value.trim()); value = '';
      if (row.some(cell => cell.length > 0) || row.length > 1) rows.push(row);
      row = [];
      continue;
    }
    value += char;
  }
  if (quoted) throw new Error('Unclosed quoted cell in CSV/TSV input.');
  row.push(value.trim());
  if (row.some(cell => cell.length > 0) || row.length > 1) rows.push(row);
  if (rows.length === 0) throw new Error('Table input is empty.');
  if (rows.length > MAX_ROWS) throw new Error(`Table has more than ${MAX_ROWS} rows.`);

  const columns = Math.max(...rows.map(next => next.length));
  if (columns > MAX_COLUMNS) throw new Error(`Table has more than ${MAX_COLUMNS} columns.`);
  const normalized = rows.map(next => [...next, ...Array(Math.max(0, columns - next.length)).fill('')]);
  return { rows: normalized, delimiter };
}

function markdownCell(value: string): string {
  return value.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
}

function latexCell(value: string): string {
  return [...value].map(char => {
    switch (char) {
      case '\\': return '\\textbackslash{}';
      case '#': return '\\#';
      case '$': return '\\$';
      case '%': return '\\%';
      case '&': return '\\&';
      case '_': return '\\_';
      case '{': return '\\{';
      case '}': return '\\}';
      case '~': return '\\textasciitilde{}';
      case '^': return '\\textasciicircum{}';
      case '\n': case '\r': return ' ';
      default: return char;
    }
  }).join('');
}

function typstString(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, ' '));
}

export function renderTable(table: ParsedTable, options: RenderTableOptions): string {
  const { rows } = table;
  const header = options.hasHeader ? rows[0] : null;
  const body = options.hasHeader ? rows.slice(1) : rows;
  const columns = rows[0].length;

  if (options.format === 'markdown') {
    const headerRow = header ?? Array.from({ length: columns }, (_, index) => `Column ${index + 1}`);
    return [
      `| ${headerRow.map(markdownCell).join(' | ')} |`,
      `| ${headerRow.map(() => '---').join(' | ')} |`,
      ...body.map(row => `| ${row.map(markdownCell).join(' | ')} |`),
    ].join('\n');
  }

  if (options.format === 'latex') {
    const align = 'l'.repeat(columns);
    const lines = ['\\begin{tabular}{' + align + '}', '\\toprule'];
    if (header) { lines.push(header.map(latexCell).join(' & ') + ' \\\\', '\\midrule'); }
    lines.push(...body.map(row => row.map(latexCell).join(' & ') + ' \\\\'));
    lines.push('\\bottomrule', '\\end{tabular}');
    return lines.join('\n');
  }

  const args: string[] = [];
  if (header) args.push(`table.header(${header.map(cell => `text(${typstString(cell)})`).join(', ')})`);
  args.push(...body.flatMap(row => row.map(cell => `text(${typstString(cell)})`)));
  return `#table(\n  columns: ${columns},\n  ${args.join(',\n  ')},\n)`;
}
