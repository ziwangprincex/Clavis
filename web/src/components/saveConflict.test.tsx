import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SaveConflictNotice } from './SaveConflictNotice';
import { useTabsStore } from '../store/tabs';
import { fs } from '../api/tauri';
import { saveTabToDisk } from '../files/save';

vi.mock('../api/tauri', () => ({ hasTauri: () => true, fs: { readDocument: vi.fn(), probeDocuments: vi.fn() } }));
vi.mock('../files/save', () => ({ saveTabToDisk: vi.fn() }));
const disk = { content: 'external', revision: 'external-revision', stamp: 'external-stamp' };
let tree: ReactTestRenderer | undefined;
const button = (text: string) => tree!.root.findAllByType('button').find(b => b.children.join('') === text)!;
const mount = () => act(() => { tree = create(<SaveConflictNotice />); });
const review = () => act(() => button('Review').props.onClick());
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('document', { activeElement: { focus: vi.fn() } });
  vi.mocked(fs.readDocument).mockResolvedValue(disk);
  useTabsStore.setState({ activeTabId: 'a', tabs: [{ id: 'a', title: 'main.typ', filePath: '/p/main.typ', lang: 'typst', content: 'local', isDirty: true, diskRevision: 'base', conflict: { targetPath: '/p/main.typ', disk } }] });
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; vi.unstubAllGlobals(); });
describe('quiet conflict review', () => {
  it('shows a notice, not a modal, until Review is clicked', () => {
    mount(); expect(tree!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    expect(tree!.root.findAllByProps({ role: 'status' })).toHaveLength(1);
    review(); expect(tree!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1);
    expect(tree!.root.findByProps({ 'aria-label': 'Version on disk' }).props.value).toBe('external');
    expect(tree!.root.findByProps({ 'aria-label': 'Merged document' }).props.value).toBe('local');
  });
  it('Later keeps hand-edited merge text as a recovery scratch document', () => {
    mount(); review();
    act(() => tree!.root.findByProps({ 'aria-label': 'Merged document' }).props.onChange({ target: { value: 'manual merge' } }));
    act(() => button('Later').props.onClick());
    expect(tree!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    expect(useTabsStore.getState().tabs.map(t => t.content)).toEqual(['local', 'manual merge']);
    expect(useTabsStore.getState().activeTabId).toBe('a');
    expect(saveTabToDisk).not.toHaveBeenCalled();
  });
  it('passes reviewed disk revision and the original buffer to merged save', async () => {
    mount(); review();
    act(() => tree!.root.findByProps({ 'aria-label': 'Merged document' }).props.onChange({ target: { value: 'merged' } }));
    vi.mocked(saveTabToDisk).mockResolvedValue('/p/main.typ');
    await act(async () => { button('Save merged version').props.onClick(); });
    expect(saveTabToDisk).toHaveBeenCalledWith('a', { resolution: { targetPath: '/p/main.typ', revision: disk.revision, buffer: 'local', merged: 'merged' } });
  });
  it('retains the current local buffer when choosing the disk version', async () => {
    mount(); review();
    await act(async () => { button('Use disk version').props.onClick(); });
    expect(useTabsStore.getState().tabs[0]).toMatchObject({ content: 'external', isDirty: false, conflict: undefined });
    expect(useTabsStore.getState().tabs[1]).toMatchObject({ content: 'local', filePath: null, isDirty: true });
    expect(useTabsStore.getState().activeTabId).toBe('a');
  });
  it('rechecks disk before accepting it and does not discard when it changes again', async () => {
    mount(); review(); vi.mocked(fs.readDocument).mockResolvedValue({ ...disk, content: 'newer external', revision: 'newer' });
    await act(async () => { button('Use disk version').props.onClick(); });
    expect(useTabsStore.getState().tabs[0].content).toBe('local');
    expect(button('Save merged version').props.disabled).toBe(true);
    expect(JSON.stringify(tree!.toJSON())).toContain('Disk changed again');
  });
  it('disables replacement when local text changed while reviewing', () => {
    mount(); review(); act(() => useTabsStore.getState().patchTab('a', { content: 'newer local' }));
    expect(button('Save merged version').props.disabled).toBe(true);
    expect(button('Keep local · replace disk').props.disabled).toBe(true);
    expect(button('Save local as…').props.disabled).toBe(false);
  });
  it('file deletion cannot load an empty disk version over the buffer', () => {
    useTabsStore.getState().patchTab('a', { conflict: { targetPath: '/p/main.typ', disk: { content: null, revision: 'missing', stamp: 'missing' } } });
    mount(); review(); expect(button('Use disk version').props.disabled).toBe(true);
  });
});
