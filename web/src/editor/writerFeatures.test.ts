import { describe, expect, it, vi } from 'vitest';
import { Text } from '@codemirror/state';
import { ProseIndex } from './proseIndex';
import { previewDocuments, revisionCounter } from '../compile/previewRevision';
import { findReadingMatches } from '../compile/readingText';
import { guidance } from '../compile/guidance';
import { formulaHtml } from './inlineMath';
import { ipc, type TypstPage } from '../api/tauri';
import type { Tab } from '../store/tabs';
vi.mock('../api/tauri', () => ({ ipc: { renderFormula: vi.fn() } }));
const tab = (path: string | null, content = ''): Tab => ({
  id: path ?? 'scratch',
  title: 'main',
  filePath: path,
  content,
  lang: 'typst',
  isDirty: false,
});
const page = (words: string[]): TypstPage => ({
  svg: '<svg/>',
  svgHash: 'test',
  width: 600,
  height: 800,
  points: [],
  links: [],
  text: words.map((text) => ({ text, width: 40, size: 12, matrix: [1, 0, 0, 1, 10, 12] })),
});
describe('incremental prose spelling', () => {
  it('visits only the changed line of a 30,000-line document', () => {
    const lines = Array.from({ length: 30000 }, (_, i) => `Line ${i}: $a+b$ and prose.`);
    const index = new ProseIndex('latex');
    index.update(Text.of(lines));
    lines[15000] = 'Edited $c+d$';
    expect(index.update(Text.of(lines), 15001, 15001, 0).scanned).toBe(1);
  });
  it('propagates an opened multiline environment until its closing boundary', () => {
    const index = new ProseIndex('latex');
    index.update(Text.of(['prose', 'one', 'two', '\\end{align}', 'tail']));
    const result = index.update(Text.of(['\\begin{align}', 'one', 'two', '\\end{align}', 'tail']), 1, 1, 0);
    expect(result.scanned).toBe(4);
    expect(index.stateBefore(2)).toBe('\\end{align}');
    expect(index.stateBefore(5)).toBe('');
  });
  it('handles inserted/deleted lines without rescanning an unchanged suffix', () => {
    const index = new ProseIndex('markdown');
    index.update(Text.of(['a', 'b', 'c']));
    expect(index.update(Text.of(['a', 'new', 'b', 'c']), 2, 2, 1).scanned).toBe(1);
    expect(index.update(Text.of(['a', 'b', 'c']), 2, 2, -1).scanned).toBe(1);
  });
  it('tracks fenced code and multiline math for both markup languages', () => {
    for (const language of ['markdown', 'typst'] as const) {
      const index = new ProseIndex(language);
      index.update(Text.of(['```', '$not_math$', '```', 'text $yes$']));
      expect(index.stateBefore(2)).toBe('```');
      expect(index.stateBefore(4)).toBe('');
    }
  });
});
describe('project scoped preview revisions', () => {
  it('excludes unrelated documents and scratch buffers', () => {
    expect(
      previewDocuments(
        [tab('/p/main.typ'), tab('/p/child.typ'), tab('/else/x.typ'), tab(null)],
        '/p/main.typ',
        '/p',
      ).map((t) => t.filePath),
    ).toEqual(['/p/main.typ', '/p/child.typ']);
    expect(previewDocuments([tab(null), tab('/other')], null, null)).toEqual([]);
  });
  it('uses actual dependencies after compilation', () => {
    expect(
      previewDocuments([tab('/p/main.typ'), tab('/p/unused.typ'), tab('/p/child.typ')], '/p/main.typ', '/p', [
        '/p/child.typ',
      ]).map((t) => t.filePath),
    ).toEqual(['/p/main.typ', '/p/child.typ']);
  });
  it('does not serialize content or react to object identity changes', () => {
    const version = revisionCounter();
    const text = 'large text'.repeat(100000);
    expect(version(['/p/main.typ', text])).toBe(version(['/p/main.typ', text]));
    expect(version(['/p/main.typ', text + '!'])).toBe('2');
  });
});
describe('complete reading index', () => {
  it('searches unmounted pages and across adjacent text fragments', () => {
    const pages = Array.from({ length: 300 }, () => page(['hello', ' world']));
    const hits = findReadingMatches(pages, 'HELLO WORLD');
    expect(hits).toHaveLength(300);
    expect(hits[299]).toMatchObject({ page: 299, runs: [0, 1] });
  });
  it('finds phrases over a typeset line break', () => {
    const p = page(['hello', 'world']);
    p.text[1].matrix[5] = 30;
    expect(findReadingMatches([p], 'hello world')).toHaveLength(1);
  });
  it('does not interpret regex input and handles empty queries', () => {
    expect(findReadingMatches([page(['a+b [test]'])], 'a+b')).toHaveLength(1);
    expect(findReadingMatches([page(['x'])], ' ')).toEqual([]);
  });
});
describe('diagnostics and formulas', () => {
  it('routes common failures to one relevant action', () => {
    expect(guidance('latex', 'Citation undefined; rerun biber').action).toBe('full-build');
    expect(guidance('latex', 'fontspec requires XeTeX').action).toBe('engine');
    expect(guidance('typst', 'unknown variable: foo').action).toBe('source');
    expect(guidance('latex', 'failed to spawn engine').action).toBe('environment');
  });
  it('renders latex without altering source and leaves unknown macros as source', async () => {
    expect(await formulaHtml('a^2+b^2', false, 'latex')).toContain('katex');
    expect(await formulaHtml('\\notARealClavisMacro', false, 'latex')).toBeNull();
  });
  it('uses the separate Typst formula endpoint and reuses cached output', async () => {
    vi.mocked(ipc.renderFormula).mockResolvedValue('<svg/>');
    expect(await formulaHtml('writer_test_formula', false, 'typst')).toBe('<svg/>');
    await formulaHtml('writer_test_formula', false, 'typst');
    expect(ipc.renderFormula).toHaveBeenCalledTimes(1);
  });
});
