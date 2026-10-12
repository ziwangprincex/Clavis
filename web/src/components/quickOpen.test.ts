import { describe, expect, it } from 'vitest';
import { rankQuickOpen, type QuickOpenItem } from './QuickOpen';

const file = (name: string, detail = name): QuickOpenItem => ({ kind: 'file', name, detail, path: `/p/${detail}` });

describe('Quick Open ranking', () => {
  const items = [file('notes.md'), file('main.tex', 'paper/main.tex'), file('remain.md', 'old/remain.md'), file('index.md', 'paper/index.md')];

  it('puts name prefixes first, then names, paths and letters in order', () => {
    expect(rankQuickOpen(items, 'main').map(item => item.name)).toEqual(['main.tex', 'remain.md']);
    expect(rankQuickOpen(items, 'paper').map(item => item.name)).toEqual(['main.tex', 'index.md']);
    expect(rankQuickOpen(items, 'ntmd').map(item => item.name)).toEqual(['notes.md']);
    expect(rankQuickOpen(items, '  ')).toBe(items);
  });

  it('reads :N as a line of the active document', () => {
    expect(rankQuickOpen(items, ':42')).toMatchObject([{ kind: 'line', line: 42 }]);
  });
});
