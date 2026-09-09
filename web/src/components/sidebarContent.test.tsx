import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';
import { FolderTreeSection } from './FolderTreeSection';
import { OutlineSection } from './OutlineSection';
import { defaultSettings, useSettingsStore, useTabsStore, useProjectStore } from '../store';
import { ipc } from '../api/tauri';

vi.mock('../api/tauri', () => ({ hasTauri: () => false, ipc: { scanFolderShallow: vi.fn() } }));
let tree: ReactTestRenderer;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
const button = (label: string) => tree.root.findAllByType('button').find(node => text(node).trim() === label);
const visibleButtons = () => tree.root.findAllByType('button').filter(node => {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.props.hidden) return false;
  return true;
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  useSettingsStore.setState({ settings: { ...defaultSettings, ui_language: 'en' } });
  useProjectStore.getState().reset();
  useTabsStore.setState({ activeTabId: 'draft', tabs: [{ id: 'draft', title: 'Untitled', filePath: null, lang: 'markdown', content: '', isDirty: false }] });
  vi.mocked(ipc.scanFolderShallow).mockResolvedValue({ name: 'paper', path: '/paper', isDir: true, children: [{ name: 'main.tex', path: '/paper/main.tex', isDir: false, children: [] }] });
});
afterEach(() => { act(() => tree?.unmount()); vi.unstubAllGlobals(); });

describe('compact sidebar contents', () => {
  it('shows only navigation icons and one open-folder row for a blank note', async () => {
    const open = vi.fn();
    await act(async () => { tree = create(<Sidebar onOpenFolder={open} folderTree={<FolderTreeSection rootPath={null} onOpenFolder={open} />} outline={<OutlineSection />} />); });
    expect(visibleButtons().map(node => node.props['aria-label'] ?? text(node))).toEqual(['Document', 'Research', 'Open folder']);
    expect(button('Outline')).toBeUndefined();
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/No folder|no headings|no document/);
    act(() => visibleButtons().find(node => text(node) === 'Open folder')!.props.onClick());
    expect(open).toHaveBeenCalledOnce();
    expect(ipc.scanFolderShallow).not.toHaveBeenCalled();
  });
  it.each([
    ['markdown', '# Introduction'], ['latex', '\\section{Introduction}'], ['typst', '= Introduction'],
  ] as const)('shows %s outline only when headings exist and preserves navigation', async (lang, content) => {
    const jump = vi.fn();
    useTabsStore.getState().patchTab('draft', { lang });
    await act(async () => { tree = create(<OutlineSection onJumpTo={jump} />); });
    expect(tree.toJSON()).toBeNull();
    act(() => useTabsStore.getState().patchTab('draft', { content }));
    expect(button('Outline')?.props['aria-expanded']).toBe(true);
    act(() => button('IntroductionL1')!.props.onClick());
    expect(jump).toHaveBeenCalledWith(null, 1);
    act(() => button('Outline')!.props.onClick());
    expect(button('Outline')?.props['aria-expanded']).toBe(false);
    act(() => useTabsStore.getState().patchTab('draft', { content: 'No heading' }));
    expect(tree.toJSON()).toBeNull();
  });
  it('keeps project headings linked to their source and ignores unrelated documents', async () => {
    const jump = vi.fn();
    useTabsStore.getState().patchTab('draft', { lang: 'latex', filePath: '/paper/main.tex', content: '\\section{Live introduction}' });
    useProjectStore.getState().setProject({ rootAbs: '/paper/main.tex', files: [
      { absPath: '/paper/main.tex', relPath: 'main.tex', content: '\\section{Old introduction}' },
      { absPath: '/paper/chapter.tex', relPath: 'chapter.tex', content: '\\section{Methods}' },
    ] });
    await act(async () => { tree = create(<OutlineSection onJumpTo={jump} />); });
    expect(button('Live introductionL1')).toBeDefined();
    expect(button('Old introductionL1')).toBeUndefined();
    act(() => button('MethodsL1')!.props.onClick());
    expect(jump).toHaveBeenCalledWith('/paper/chapter.tex', 1);
    act(() => useTabsStore.getState().patchTab('draft', { filePath: '/other.tex', content: '' }));
    expect(tree.toJSON()).toBeNull();
  });
  it('keeps the real folder name and file actions without a second Folder heading', async () => {
    const activate = vi.fn();
    const close = vi.fn();
    await act(async () => { tree = create(<Sidebar folderTree={<FolderTreeSection rootPath="/paper" onFileActivate={activate} onCloseFolder={close} />} />); });
    expect(button('Folder')).toBeUndefined();
    expect(text(tree.root)).toContain('paper');
    await act(async () => { await button('main.tex')!.props.onClick(); });
    expect(activate).toHaveBeenCalledWith('/paper/main.tex');
    expect(tree.root.findAllByProps({ title: 'Rescan' })).toHaveLength(0);
    act(() => tree.root.findByProps({ title: 'Close folder' }).props.onClick());
    expect(close).toHaveBeenCalledOnce();
  });
  it('returns to the single folder action after closing a folder', async () => {
    await act(async () => { tree = create(<FolderTreeSection rootPath="/paper" />); });
    await act(async () => tree.update(<FolderTreeSection rootPath={null} />));
    expect(tree.root.findAllByType('button')).toHaveLength(1);
    expect(text(tree.root)).toBe('Open folder');
    expect(tree.root.findAllByType('li')).toHaveLength(0);
  });
});
