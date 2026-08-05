export type DiffPart = { kind: 'equal' | 'insert' | 'delete'; text: string };

const MAX_TOKENS = 700;
const TOKEN = /\s+|[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*|[^\s]/gu;

function tokens(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

export function proseDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before); const b = tokens(after);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return lineDiff(before, after);
  const rows = a.length + 1; const cols = b.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const previous = parts.at(-1);
    if (previous?.kind === kind) previous.text += text;
    else parts.push({ kind, text });
  };
  let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('equal', a[i]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) { push('delete', a[i++]); }
    else { push('insert', b[j++]); }
  }
  while (i < a.length) push('delete', a[i++]);
  while (j < b.length) push('insert', b[j++]);
  return parts;
}

function lineDiff(before: string, after: string): DiffPart[] {
  if (before === after) return [{ kind: 'equal', text: before }];
  return [
    ...(before ? [{ kind: 'delete' as const, text: before }] : []),
    ...(after ? [{ kind: 'insert' as const, text: after }] : []),
  ];
}

export function normalizeLatexForDiff(text: string): string {
  return text
    .replace(/%[^\n]*/g, '')
    .replace(/\\(?:emph|textbf|textit)\{([^{}]*)\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
