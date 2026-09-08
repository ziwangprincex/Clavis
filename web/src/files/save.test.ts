import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fs, dialogSave } from '../api/tauri';
import { useTabsStore } from '../store/tabs';
import { useStatusStore } from '../store/status';
import { saveTabToDisk } from './save';
import { autosaveDirtyTabs } from './session';

vi.mock('../api/tauri', () => ({
  hasTauri: () => true,
  fs: { writeTextFile: vi.fn() },
  dialogSave: vi.fn(),
  ipc: {},
}));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
const current = () => useTabsStore.getState().tabs[0];
beforeEach(() => {
  vi.resetAllMocks();
  useTabsStore.setState({ activeTabId: 'a', tabs: [{ id: 'a', filePath: '/p/a.tex', title: 'a.tex', lang: 'latex', content: 'old', isDirty: true }] });
});

describe('snapshot-aware save queue', () => {
  it('keeps new edits dirty while a manual write is pending', async () => {
    const gate = deferred();
    vi.mocked(fs.writeTextFile).mockReturnValue(gate.promise);
    const saving = saveTabToDisk('a');
    await vi.waitFor(() => expect(fs.writeTextFile).toHaveBeenCalledWith('/p/a.tex', 'old'));
    useTabsStore.getState().patchTab('a', { content: 'new' });
    gate.resolve();
    await saving;
    expect(current().isDirty).toBe(true);
    expect(current().content).toBe('new');
  });
  it('applies the same rule to autosave', async () => {
    const gate = deferred();
    vi.mocked(fs.writeTextFile).mockReturnValue(gate.promise);
    const saving = autosaveDirtyTabs();
    await vi.waitFor(() => expect(fs.writeTextFile).toHaveBeenCalled());
    useTabsStore.getState().patchTab('a', { content: 'new' });
    gate.resolve();
    await saving;
    expect(current().isDirty).toBe(true);
  });
  it('serializes writes and snapshots the latest content when dequeued', async () => {
    const gate = deferred();
    vi.mocked(fs.writeTextFile).mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const first = saveTabToDisk('a');
    await vi.waitFor(() => expect(fs.writeTextFile).toHaveBeenCalledTimes(1));
    const second = saveTabToDisk('a', { automatic: true });
    useTabsStore.getState().patchTab('a', { content: 'new' });
    expect(fs.writeTextFile).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all([first, second]);
    expect(fs.writeTextFile).toHaveBeenLastCalledWith('/p/a.tex', 'new');
    expect(current().isDirty).toBe(false);
  });
  it('does not poison the queue when a write fails', async () => {
    vi.mocked(fs.writeTextFile).mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    await expect(saveTabToDisk('a')).rejects.toThrow('disk full');
    expect(current().isDirty).toBe(true);
    expect(useStatusStore.getState().text).toContain('Save failed:');
    await saveTabToDisk('a');
    expect(current().isDirty).toBe(false);
    expect(useStatusStore.getState().text).toBe('Ready');
  });
  it('leaves the document unchanged when Save As is cancelled', async () => {
    vi.mocked(dialogSave).mockResolvedValue(null);
    expect(await saveTabToDisk('a', { saveAs: true })).toBeNull();
    expect(fs.writeTextFile).not.toHaveBeenCalled();
    expect(current().isDirty).toBe(true);
  });
  it('reads the buffer after the Save As dialog completes', async () => {
    vi.mocked(dialogSave).mockImplementation(async () => {
      useTabsStore.getState().patchTab('a', { content: 'after dialog' });
      return '/p/b.tex';
    });
    await saveTabToDisk('a', { saveAs: true });
    expect(fs.writeTextFile).toHaveBeenCalledWith('/p/b.tex', 'after dialog');
    expect(current().filePath).toBe('/p/b.tex');
    expect(current().isDirty).toBe(false);
  });
  it('does not resurrect a closed document', async () => {
    const gate = deferred();
    vi.mocked(fs.writeTextFile).mockReturnValue(gate.promise);
    const saving = saveTabToDisk('a');
    await vi.waitFor(() => expect(fs.writeTextFile).toHaveBeenCalled());
    useTabsStore.getState().closeTab('a');
    gate.resolve();
    await saving;
    expect(useTabsStore.getState().tabs).toEqual([]);
  });
  it('skips scratch documents in autosave', async () => {
    useTabsStore.getState().patchTab('a', { filePath: null });
    await autosaveDirtyTabs();
    expect(fs.writeTextFile).not.toHaveBeenCalled();
  });
});
