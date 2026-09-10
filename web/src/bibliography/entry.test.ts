import { beforeEach, expect, it, vi } from 'vitest';
import { bibliographyDocuments, createBibLookup } from './entry';
import { ipc, type BibEntry } from '../api/tauri';

vi.mock('../api/tauri', () => ({ ipc: { parseBib: vi.fn() } }));
const entry: BibEntry = { key: 'key', entryType: 'book', title: 'Report',
  author: 'World Health Organization', keywords: [], sourceFile: '/p/refs.bib', sourceLine: 2, sourceEndLine: 6 };
const documents = [{ path: '/p/refs.bib', content: '@book(key, title={Report})' }];
beforeEach(() => { vi.resetAllMocks(); vi.mocked(ipc.parseBib).mockResolvedValue([entry]); });

it('passes editor snapshots to the existing parser and reuses unchanged results', async () => {
  const lookup = createBibLookup();
  expect(await lookup(documents, 'key')).toEqual(entry);
  expect(await lookup(documents.map(doc => ({ ...doc })), 'missing')).toBeNull();
  expect(ipc.parseBib).toHaveBeenCalledOnce();
  expect(ipc.parseBib).toHaveBeenCalledWith([], documents);
});
it('invalidates when unsaved bibliography content changes or a file is removed', async () => {
  const lookup = createBibLookup();
  await lookup(documents, 'key');
  await lookup([{ ...documents[0], content: '@book(key, title={Edited})' }], 'key');
  vi.mocked(ipc.parseBib).mockResolvedValue([]);
  expect(await lookup([], 'key')).toBeNull();
  expect(ipc.parseBib).toHaveBeenCalledTimes(2);
});
it('does not turn a failed parse into a missing key and allows retries', async () => {
  const lookup = createBibLookup();
  vi.mocked(ipc.parseBib).mockRejectedValueOnce(new Error('worker failed'));
  await expect(lookup(documents, 'key')).rejects.toThrow('worker failed');
  expect(await lookup([], 'key')).toBeNull();
  expect(await lookup(documents, 'key')).toEqual(entry);
});
it('does not cache an older result over a newer snapshot', async () => {
  const lookup = createBibLookup();
  let finish!: (entries: BibEntry[]) => void;
  vi.mocked(ipc.parseBib).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const old = lookup(documents, 'key');
  const updated = [{ ...documents[0], content: '@book(key, title={New})' }];
  vi.mocked(ipc.parseBib).mockResolvedValue([{ ...entry, title: 'New' }]);
  expect((await lookup(updated, 'key'))?.title).toBe('New');
  finish([entry]);
  await old;
  expect((await lookup(updated, 'key'))?.title).toBe('New');
  expect(ipc.parseBib).toHaveBeenCalledTimes(2);
});
it('parses only bibliography files, not TeX snippets or scratch buffers', () => {
  expect(bibliographyDocuments([
    { path: '/p/main.tex', text: '@book(key, title={Fake})', language: 'latex' },
    { path: '/p/refs.BIB', text: 'unsaved', language: 'latex' },
    { path: null, text: '@book(key, title={Scratch})', language: 'latex' },
  ])).toEqual([{ path: '/p/refs.BIB', content: 'unsaved' }]);
});
