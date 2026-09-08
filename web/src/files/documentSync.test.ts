import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fs, type DiskSnapshot } from '../api/tauri';
import { useTabsStore } from '../store/tabs';
import { checkExternalDocuments, documentOperation, reconcileTab } from './documentSync';
import { decodeSessionSnapshot, encodeSessionSnapshot } from './sessionModel';

vi.mock('../api/tauri', () => ({ hasTauri: () => true, fs: { readDocument: vi.fn(), probeDocuments: vi.fn() } }));
const disk: DiskSnapshot = { content: 'external', revision: 'external-revision', stamp: 'new-stamp' };
const current = () => useTabsStore.getState().tabs[0];
const reconcile = () => documentOperation(() => reconcileTab('a'));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fs.readDocument).mockResolvedValue(disk);
  vi.mocked(fs.probeDocuments).mockResolvedValue([{ path: '/p/a.typ', stamp: 'new-stamp', error: null }]);
  useTabsStore.setState({ activeTabId: 'a', tabs: [{ id: 'a', filePath: '/p/a.typ', title: 'a.typ', lang: 'typst', content: 'base', isDirty: false, diskRevision: 'base-revision', diskStamp: 'base-stamp' }] });
});
describe('external document changes', () => {
  it('reloads a clean known-baseline document without moving focus', async () => {
    await reconcile();
    expect(current()).toMatchObject({ content: 'external', isDirty: false, diskRevision: disk.revision, diskStamp: disk.stamp });
    expect(useTabsStore.getState().activeTabId).toBe('a');
  });
  it('preserves both versions when the local buffer is dirty', async () => {
    useTabsStore.getState().patchTab('a', { content: 'local', isDirty: true });
    await reconcile();
    expect(current()).toMatchObject({ content: 'local', isDirty: true, diskRevision: 'base-revision', conflict: { disk } });
  });
  it('keeps a local edit made while the disk read is pending', async () => {
    let resolve!: (value: DiskSnapshot) => void;
    vi.mocked(fs.readDocument).mockReturnValue(new Promise(done => { resolve = done; }));
    const operation = reconcile();
    await vi.waitFor(() => expect(fs.readDocument).toHaveBeenCalled());
    useTabsStore.getState().patchTab('a', { content: 'typed during read', isDirty: true });
    resolve(disk); await operation;
    expect(current().content).toBe('typed during read'); expect(current().conflict?.disk).toEqual(disk);
  });
  it('does not touch a closed or retargeted tab after a read', async () => {
    let resolve!: (value: DiskSnapshot) => void;
    vi.mocked(fs.readDocument).mockReturnValue(new Promise(done => { resolve = done; }));
    const operation = reconcile(); await vi.waitFor(() => expect(fs.readDocument).toHaveBeenCalled());
    useTabsStore.getState().patchTab('a', { filePath: '/p/b.typ' });
    resolve(disk); await operation;
    expect(current()).toMatchObject({ content: 'base', filePath: '/p/b.typ' });
  });
  it('equal content clears dirty/conflict, but unchanged disk does not clear local edits', async () => {
    useTabsStore.getState().patchTab('a', { content: 'external', isDirty: true, conflict: { targetPath: '/p/a.typ', disk } });
    await reconcile(); expect(current().isDirty).toBe(false); expect(current().conflict).toBeUndefined();
    useTabsStore.getState().patchTab('a', { content: 'local again', isDirty: true });
    await reconcile(); expect(current().isDirty).toBe(true); expect(current().conflict).toBeUndefined();
  });
  it('a legacy clean session without a disk baseline never silently discards recovery text', async () => {
    useTabsStore.getState().patchTab('a', { diskRevision: undefined });
    await reconcile(); expect(current().content).toBe('base'); expect(current().conflict?.disk).toEqual(disk);
  });
  it('deletion keeps the buffer and requests explicit recreation or Save As', async () => {
    vi.mocked(fs.readDocument).mockResolvedValue({ content: null, revision: 'missing', stamp: 'missing' });
    await reconcile(); expect(current()).toMatchObject({ content: 'base', isDirty: true, conflict: { disk: { content: null } } });
  });
  it('permission failures surface an error and preserve all local text', async () => {
    vi.mocked(fs.readDocument).mockRejectedValue(new Error('permission denied'));
    await reconcile(); expect(current().diskError).toContain('permission denied'); expect(current().content).toBe('base');
  });
  it('polls metadata without rereading unchanged long documents', async () => {
    vi.mocked(fs.probeDocuments).mockResolvedValue([{ path: '/p/a.typ', stamp: 'base-stamp', error: null }]);
    await checkExternalDocuments(); expect(fs.readDocument).not.toHaveBeenCalled();
    await checkExternalDocuments(true); expect(fs.readDocument).toHaveBeenCalledTimes(1);
  });
  it('does not suppress future probes after an IPC failure', async () => {
    vi.mocked(fs.probeDocuments).mockRejectedValueOnce(new Error('offline'));
    await expect(checkExternalDocuments()).rejects.toThrow('offline');
    await checkExternalDocuments(); expect(current().content).toBe('external');
  });
  it('persists only the disk revision, not stamps, errors or a stale conflict payload', () => {
    const revision = `sha256:${'a'.repeat(64)}`;
    useTabsStore.getState().patchTab('a', { diskRevision: revision, conflict: { targetPath: '/p/a.typ', disk }, diskError: 'temporary' });
    const raw = encodeSessionSnapshot(useTabsStore.getState().tabs, 'a');
    expect(raw).not.toContain('diskStamp'); expect(raw).not.toContain('conflict'); expect(raw).not.toContain('temporary');
    expect(decodeSessionSnapshot(raw)?.tabs[0].diskRevision).toBe(revision);
    expect(decodeSessionSnapshot(raw.replace(revision, 'invalid'))?.tabs[0].diskRevision).toBeUndefined();
  });
});
