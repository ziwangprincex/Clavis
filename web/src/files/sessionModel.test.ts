import { describe, expect, it } from 'vitest';
import { decodeSessionSnapshot, encodeSessionSnapshot } from './sessionModel';
import type { Tab } from '../store/tabs';

function persistedTab(over: Record<string, unknown> = {}) {
  return {
    title: 'note.md',
    filePath: null,
    lang: 'markdown',
    content: 'hello',
    isDirty: false,
    ...over,
  };
}

function raw(tabs: unknown[], activeIndex = 0, version = 2): string {
  return JSON.stringify({ version, activeIndex, tabs });
}

describe('Session Snapshot', () => {
  it.each(['/paper', 'C:\\Papers\\Thesis', '\\\\?\\C:\\Papers\\Thesis', '\\\\server\\papers'])('preserves an explicit absolute folder: %s', folderPath => {
    expect(decodeSessionSnapshot(encodeSessionSnapshot([], null, folderPath))).toMatchObject({ folderPath, tabs: [] });
  });

  it.each(['relative/path', '', 42, '/paper\0bad'])('ignores an invalid folder without losing recoverable documents: %s', folderPath => {
    const result = decodeSessionSnapshot(JSON.stringify({ version: 2, folderPath, tabs: [persistedTab()], activeIndex: 0 }));
    expect(result?.folderPath).toBeNull();
    expect(result?.tabs).toHaveLength(1);
  });

  it('rejects unreadable, unsupported, and empty snapshots', () => {
    expect(decodeSessionSnapshot('{')).toBeNull();
    expect(decodeSessionSnapshot(raw([], 0))).toBeNull();
    expect(decodeSessionSnapshot(raw([persistedTab()], 0, 99))).toBeNull();
  });

  it('skips damaged tabs without discarding valid scratch work', () => {
    const result = decodeSessionSnapshot(raw([
      persistedTab({ title: 'first.md', content: 'safe' }),
      persistedTab({ title: 123 }),
      persistedTab({ filePath: '/tmp/bad.md', content: null }),
      persistedTab({ title: 'second.typ', lang: 'typst', content: '#let x = 1', isDirty: true }),
    ], 3));

    expect(result?.tabs).toEqual([
      persistedTab({ title: 'first.md', content: 'safe' }),
      persistedTab({ title: 'second.typ', lang: 'typst', content: '#let x = 1', isDirty: true }),
    ]);
    expect(result?.activeIndex).toBe(1);
  });

  it('deduplicates file-backed tabs by normalized path and keeps the last version', () => {
    const result = decodeSessionSnapshot(raw([
      persistedTab({ title: 'OLD.md', filePath: 'C:\\Work\\Note.md', content: 'old' }),
      persistedTab({ title: 'scratch', content: 'one' }),
      persistedTab({ title: 'stale title', filePath: '\\\\?\\C:\\Work\\Note.md', lang: 'typst', content: 'new', isDirty: true }),
      persistedTab({ title: 'scratch', content: 'two' }),
    ], 0));

    expect(result?.tabs).toHaveLength(3);
    expect(result?.tabs[0]).toMatchObject({
      title: 'Note.md',
      filePath: '\\\\?\\C:\\Work\\Note.md',
      lang: 'markdown',
      content: 'new',
      isDirty: true,
    });
    expect(result?.tabs.slice(1).map(tab => tab.content)).toEqual(['one', 'two']);
    expect(result?.activeIndex).toBe(0);
  });

  it('derives file-backed title and language from the path', () => {
    const result = decodeSessionSnapshot(raw([
      persistedTab({ title: 'wrong.md', filePath: '/work/main.tex', lang: 'typst' }),
      persistedTab({ title: 'wrong.typ', filePath: '/work/slides.typ', lang: 'latex' }),
    ]));

    expect(result?.tabs.map(tab => [tab.title, tab.lang])).toEqual([
      ['main.tex', 'latex'],
      ['slides.typ', 'typst'],
    ]);
  });

  it.each([false, true])('restores every scratch, even beyond 50 tabs (dirty=%s)', (isDirty) => {
    const tabs: Tab[] = Array.from({ length: 75 }, (_, index) => ({
      id: String(index), title: `scratch-${index}`, filePath: null, lang: 'latex',
      content: `unique writing ${index}`, isDirty,
    }));
    const result = decodeSessionSnapshot(encodeSessionSnapshot(tabs, '69'));
    expect(result?.tabs.map(tab => tab.content)).toEqual(tabs.map(tab => tab.content));
    expect(result?.activeIndex).toBe(69);
  });

  it('does not discard file-backed unsaved buffers beyond the old limit either', () => {
    const tabs = Array.from({ length: 75 }, (_, index) => persistedTab({
      filePath: `/work/${index}.tex`, content: `unsaved ${index}`, isDirty: true,
    }));
    const result = decodeSessionSnapshot(raw(tabs, 74));
    expect(result?.tabs.map(tab => tab.content)).toEqual(tabs.map(tab => tab.content));
    expect(result?.activeIndex).toBe(74);
  });

  it('encodes only persistent tab fields and restores version 1 snapshots', () => {
    const tabs: Tab[] = [{
      id: 'runtime-only',
      title: 'draft',
      filePath: null,
      lang: 'markdown',
      content: 'text',
      isDirty: true,
      latexWorkdirToken: 'do-not-persist',
    }];
    const encoded = encodeSessionSnapshot(tabs, 'runtime-only');
    expect(JSON.parse(encoded)).toEqual({
      version: 2,
      folderPath: null,
      activeIndex: 0,
      tabs: [persistedTab({ title: 'draft', content: 'text', isDirty: true })],
    });
    expect(decodeSessionSnapshot(raw([persistedTab()], 0, 1))?.tabs).toHaveLength(1);
  });
});
