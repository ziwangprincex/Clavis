import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fs, dialogSave, type DocumentSaveResult } from '../api/tauri';
import { useTabsStore } from '../store/tabs';
import { useStatusStore } from '../store/status';
import { saveTabToDisk } from './save';
import { autosaveDirtyTabs } from './session';
import { documentRoot } from '../compile/project';
import { useProjectStore } from '../store/project';

vi.mock('../api/tauri', () => ({
  hasTauri: () => true,
  fs: { saveDocument: vi.fn(), readDocument: vi.fn(), probeDocuments: vi.fn() },
  dialogSave: vi.fn(), ipc: {},
}));
const saved = (revision = 'new-revision'): DocumentSaveResult => ({ status: 'saved', revision, stamp: '' });
const disk = { content: 'external', revision: 'external-revision', stamp: 'external-stamp' };
function deferred() {
  let resolve!: (result: DocumentSaveResult) => void;
  const promise = new Promise<DocumentSaveResult>(r => { resolve = r; });
  return { promise, resolve: () => resolve(saved()) };
}
const current = () => useTabsStore.getState().tabs[0];
beforeEach(() => {
  vi.resetAllMocks();
  useProjectStore.getState().reset();
  vi.mocked(fs.saveDocument).mockResolvedValue(saved());
  vi.mocked(fs.readDocument).mockResolvedValue({ content: null, revision: 'missing', stamp: 'missing' });
  useTabsStore.setState({ activeTabId: 'a', tabs: [{ id: 'a', filePath: '/p/a.tex', title: 'a.tex', lang: 'latex', content: 'old', isDirty: true, diskRevision: 'base', diskStamp: 'base-stamp' }] });
});

describe('version-checked save queue', () => {
  it('keeps new edits dirty while a manual write is pending', async () => {
    const gate = deferred();
    vi.mocked(fs.saveDocument).mockReturnValue(gate.promise);
    const saving = saveTabToDisk('a');
    await vi.waitFor(() => expect(fs.saveDocument).toHaveBeenCalledWith('/p/a.tex', 'old', 'base'));
    useTabsStore.getState().patchTab('a', { content: 'new' });
    gate.resolve(); await saving;
    expect(current()).toMatchObject({ content: 'new', isDirty: true, diskRevision: 'new-revision' });
  });
  it('applies the same rule to autosave', async () => {
    const gate = deferred(); vi.mocked(fs.saveDocument).mockReturnValue(gate.promise);
    const saving = autosaveDirtyTabs();
    await vi.waitFor(() => expect(fs.saveDocument).toHaveBeenCalled());
    useTabsStore.getState().patchTab('a', { content: 'new' });
    gate.resolve(); await saving;
    expect(current().isDirty).toBe(true);
  });
  it('serializes writes using the latest content and disk revision', async () => {
    const gate = deferred(); vi.mocked(fs.saveDocument).mockReturnValueOnce(gate.promise).mockResolvedValue(saved('third'));
    const first = saveTabToDisk('a');
    await vi.waitFor(() => expect(fs.saveDocument).toHaveBeenCalledTimes(1));
    const second = saveTabToDisk('a', { automatic: true });
    useTabsStore.getState().patchTab('a', { content: 'new' });
    expect(fs.saveDocument).toHaveBeenCalledTimes(1);
    gate.resolve(); await Promise.all([first, second]);
    expect(fs.saveDocument).toHaveBeenLastCalledWith('/p/a.tex', 'new', 'new-revision');
    expect(current()).toMatchObject({ isDirty: false, diskRevision: 'third' });
  });
  it('does not poison the queue when a write fails', async () => {
    vi.mocked(fs.saveDocument).mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(saved());
    await expect(saveTabToDisk('a')).rejects.toThrow('disk full');
    expect(current().isDirty).toBe(true); expect(current().diskRevision).toBe('base');
    expect(useStatusStore.getState().text).toContain('Save failed:');
    await saveTabToDisk('a');
    expect(current().isDirty).toBe(false); expect(useStatusStore.getState().text).toBe('Ready');
  });
  it('leaves the document unchanged when Save As is cancelled', async () => {
    vi.mocked(dialogSave).mockResolvedValue(null);
    expect(await saveTabToDisk('a', { saveAs: true })).toBeNull();
    expect(fs.saveDocument).not.toHaveBeenCalled(); expect(current().isDirty).toBe(true);
  });
  it('reads the buffer after the Save As dialog completes', async () => {
    vi.mocked(dialogSave).mockImplementation(async () => {
      useTabsStore.getState().patchTab('a', { content: 'after dialog' }); return '/p/b.tex';
    });
    await saveTabToDisk('a', { saveAs: true });
    expect(fs.saveDocument).toHaveBeenCalledWith('/p/b.tex', 'after dialog', 'missing');
    expect(current()).toMatchObject({ filePath: '/p/b.tex', isDirty: false });
  });
  it('does not resurrect a closed document', async () => {
    const gate = deferred(); vi.mocked(fs.saveDocument).mockReturnValue(gate.promise);
    const saving = saveTabToDisk('a'); await vi.waitFor(() => expect(fs.saveDocument).toHaveBeenCalled());
    useTabsStore.getState().closeTab('a'); gate.resolve(); await saving;
    expect(useTabsStore.getState().tabs).toEqual([]);
  });
  it('skips scratch documents, conflicts and disk errors in autosave', async () => {
    for (const patch of [{ filePath: null }, { filePath: '/p/a.tex', conflict: { targetPath: '/p/a.tex', disk } }, { conflict: undefined, diskError: 'permission denied' }]) {
      useTabsStore.getState().patchTab('a', patch); await autosaveDirtyTabs();
    }
    expect(fs.saveDocument).not.toHaveBeenCalled(); expect(dialogSave).not.toHaveBeenCalled();
  });
  it('preserves both sides and stops repeated autosaves after a conflict', async () => {
    vi.mocked(fs.saveDocument).mockResolvedValue({ status: 'conflict', disk });
    expect(await saveTabToDisk('a')).toBeNull();
    expect(current()).toMatchObject({ content: 'old', isDirty: true, diskRevision: 'base', conflict: { disk } });
    await autosaveDirtyTabs(); expect(fs.saveDocument).toHaveBeenCalledTimes(1);
  });
  it('fails closed for legacy sessions without a baseline', async () => {
    useTabsStore.getState().patchTab('a', { diskRevision: undefined });
    vi.mocked(fs.readDocument).mockResolvedValue(disk);
    await saveTabToDisk('a');
    expect(fs.saveDocument).not.toHaveBeenCalled(); expect(current().conflict?.disk).toEqual(disk);
  });
  it('accepts equal legacy content but does not silently recreate deleted files', async () => {
    useTabsStore.getState().patchTab('a', { diskRevision: undefined });
    vi.mocked(fs.readDocument).mockResolvedValueOnce({ ...disk, content: 'old' });
    await saveTabToDisk('a');
    expect(fs.saveDocument).toHaveBeenCalledWith('/p/a.tex', 'old', disk.revision);
    useTabsStore.getState().patchTab('a', { diskRevision: undefined });
    await saveTabToDisk('a'); expect(fs.saveDocument).toHaveBeenCalledTimes(1);
    expect(current().conflict?.disk.content).toBeNull();
  });
  it('requires review when Save As selects an existing different file', async () => {
    vi.mocked(dialogSave).mockResolvedValue('/p/existing.tex'); vi.mocked(fs.readDocument).mockResolvedValue(disk);
    await saveTabToDisk('a', { saveAs: true });
    expect(fs.saveDocument).not.toHaveBeenCalled();
    expect(current().filePath).toBe('/p/a.tex'); expect(current().conflict?.targetPath).toBe('/p/existing.tex');
  });
  it('explicit merge still uses the reviewed revision and keeps both recovery copies', async () => {
    useTabsStore.getState().patchTab('a', { conflict: { targetPath: '/p/a.tex', disk } });
    await saveTabToDisk('a', { resolution: { targetPath: '/p/a.tex', revision: disk.revision, buffer: 'old', merged: 'merged' } });
    expect(fs.saveDocument).toHaveBeenCalledWith('/p/a.tex', 'merged', disk.revision);
    expect(current()).toMatchObject({ content: 'merged', isDirty: false, conflict: undefined });
    expect(useTabsStore.getState().tabs.slice(1).map(t => t.content)).toEqual(['external', 'old']);
    expect(useTabsStore.getState().activeTabId).toBe('a');
  });
  it('refuses a stale local review before writing', async () => {
    useTabsStore.getState().patchTab('a', { conflict: { targetPath: '/p/a.tex', disk }, content: 'new' });
    await expect(saveTabToDisk('a', { resolution: { targetPath: '/p/a.tex', revision: disk.revision, buffer: 'old' } })).rejects.toThrow('changed while reviewing');
    expect(fs.saveDocument).not.toHaveBeenCalled();
  });
  it('rejects Save As targeting another open tab', async () => {
    useTabsStore.getState().addTab({ id: 'b', filePath: '/p/b.tex', title: 'b', lang: 'latex', content: 'other', isDirty: true });
    vi.mocked(dialogSave).mockResolvedValue('/p/b.tex');
    await expect(saveTabToDisk('a', { saveAs: true })).rejects.toThrow('already open');
    expect(fs.saveDocument).not.toHaveBeenCalled();
  });
});


describe('Save As compilation identity', () => {
  it.each(['explicit', 'collected', 'workspace', 'standalone'])('copies the main without retaining its old %s root', async (kind) => {
    if (kind === 'explicit') useTabsStore.getState().patchTab('a', { projectRoot: '/p/a.tex' });
    if (kind === 'collected') useProjectStore.setState({ rootAbs: '/p/a.tex', files: [] });
    if (kind === 'workspace') useProjectStore.setState({ workspace: {
      root: '/p', trust: 'not-required', issues: [], hasExecutableTasks: false,
      config: { project: { main: 'a.tex' }, latex: {}, paths: { generated: [], ignored: [] }, tasks: {} },
    } });
    vi.mocked(dialogSave).mockResolvedValue('/p/copy.tex');
    await saveTabToDisk('a', { saveAs: true });
    expect(current().filePath).toBe('/p/copy.tex');
    expect(documentRoot(current())).toBe('/p/copy.tex');
  });
  it('moves a Typst main to its new directory without retargeting other tabs', async () => {
    useTabsStore.getState().patchTab('a', { lang: 'typst', filePath: '/p/a.typ', projectRoot: '/p/a.typ' });
    useTabsStore.setState(state => ({ tabs: [...state.tabs, {
      id: 'child', title: 'child.typ', filePath: '/p/child.typ', projectRoot: '/p/a.typ',
      lang: 'typst', content: 'child', isDirty: true,
    }] }));
    vi.mocked(dialogSave).mockResolvedValue('/copy/a.typ');
    await saveTabToDisk('a', { saveAs: true });
    expect(documentRoot(current())).toBe('/copy/a.typ');
    expect(useTabsStore.getState().tabs[1].projectRoot).toBe('/p/a.typ');
  });
  it('preserves an explicitly selected parent main when copying a chapter', async () => {
    useTabsStore.getState().patchTab('a', { projectRoot: '/p/main.tex' });
    vi.mocked(dialogSave).mockResolvedValue('/p/chapter-copy.tex');
    await saveTabToDisk('a', { saveAs: true });
    expect(documentRoot(current())).toBe('/p/main.tex');
  });
  it('does not change a root when Save As is cancelled or conflicts', async () => {
    useTabsStore.getState().patchTab('a', { projectRoot: '/p/a.tex' });
    vi.mocked(dialogSave).mockResolvedValueOnce(null).mockResolvedValueOnce('/copy/a.tex');
    await saveTabToDisk('a', { saveAs: true });
    vi.mocked(fs.saveDocument).mockResolvedValue({ status: 'conflict', disk });
    await saveTabToDisk('a', { saveAs: true });
    expect(documentRoot(current())).toBe('/p/a.tex');
    expect(current().filePath).toBe('/p/a.tex');
  });
});
