import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderTreeSection } from './FolderTreeSection';
import { OutlineSection } from './OutlineSection';
import { defaultSettings, useSettingsStore, useTabsStore, useProjectStore } from '../store';
import { ipc, type TreeNode } from '../api/tauri';
vi.mock('../api/tauri', () => ({ hasTauri: () => false, ipc: { scanFolderShallow: vi.fn() } }));
let tree: ReactTestRenderer;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
const button = (label: string) => tree.root.findAllByType('button').find(node => text(node).trim() === label);
const folder = (path: string, children: TreeNode[] = []): TreeNode => ({ name: path.split('/').pop()!, path, isDir: true, children });
const file = (path: string): TreeNode => ({ name: path.split('/').pop()!, path, isDir: false, children: [] });
const scan = vi.mocked(ipc.scanFolderShallow);
const expandChapters = async () => { await act(async () => button('chap')!.props.onClick()); };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  useSettingsStore.setState({ settings: { ...defaultSettings, ui_language: 'en' } });
  useProjectStore.getState().reset();
  useTabsStore.setState({ activeTabId: 'draft', tabs: [{ id: 'draft', title: 'Untitled', filePath: null, lang: 'markdown', content: '', isDirty: false }] });
  scan.mockImplementation(async path => path === '/paper' ? folder(path, [folder('/paper/chap'), file('/paper/main.tex')]) : folder(path, [file('/paper/chap/one.tex')]));
});
afterEach(() => { act(() => tree?.unmount()); vi.unstubAllGlobals(); });

describe('sidebar hierarchy and automatic refresh', () => {
  it('nests real directories with a collapsible root and marks the active file', async () => {
    useTabsStore.getState().patchTab('draft', { filePath: '/paper/chap/one.tex' });
    await act(async () => { tree = create(<FolderTreeSection rootPath="/paper" />); });
    expect(button('chap')!.props['aria-expanded']).toBe(false);
    await expandChapters();
    expect(button('chap')!.props['aria-expanded']).toBe(true);
    const chapter = button('one.tex')!;
    expect(chapter.props['aria-current']).toBe('page');
    expect(chapter.parent!.parent!.parent!.type).toBe('ul');
    const group = tree.root.findByProps({ 'aria-label': 'chap' });
    expect(group.type).toBe('ul');
    expect(group.parent).toBe(button('chap')!.parent);
    act(() => button('paper')!.props.onClick());
    expect(button('paper')!.props['aria-expanded']).toBe(false);
    expect(tree.root.findByProps({ id: button('paper')!.props['aria-controls'] }).props.hidden).toBe(true);
  });
  it('refreshes on foreground and preserves expanded directories while updating their contents', async () => {
    await act(async () => { tree = create(<FolderTreeSection rootPath="/paper" />); });
    await expandChapters();
    scan.mockImplementation(async path => path === '/paper' ? folder(path, [folder('/paper/chap'), file('/paper/main.tex')]) : folder(path, [file('/paper/chap/two.tex')]));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(button('chap')!.props['aria-expanded']).toBe(true);
    expect(button('one.tex')).toBeUndefined();
    expect(button('two.tex')).toBeDefined();
    scan.mockClear();
    act(() => { Object.assign(document, { visibilityState: 'hidden' }); });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(scan).not.toHaveBeenCalled();
    act(() => { Object.assign(document, { visibilityState: 'visible' }); });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(scan).toHaveBeenCalledWith('/paper/chap');
  });
  it('keeps command-menu refresh working without a standalone rescan button', async () => {
    await act(async () => { tree = create(<FolderTreeSection rootPath="/paper" refreshKey={0} />); });
    expect(scan).toHaveBeenCalledTimes(1);
    await act(async () => tree.update(<FolderTreeSection rootPath="/paper" refreshKey={1} />));
    expect(scan).toHaveBeenCalledTimes(2);
    expect(tree.root.findAllByProps({ title: 'Rescan' })).toHaveLength(0);
  });
  it('discards an old folder scan that completes after another folder is opened', async () => {
    let resolve!: (value: TreeNode) => void;
    scan.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => { tree = create(<FolderTreeSection rootPath="/old" />); });
    await act(async () => tree.update(<FolderTreeSection rootPath="/paper" />));
    await act(async () => resolve(folder('/old', [file('/old/wrong.tex')])));
    expect(button('main.tex')).toBeDefined();
    expect(button('wrong.tex')).toBeUndefined();
    expect(button('old')).toBeUndefined();
  });
  it('keeps recovered folder identity and displays a scan error without dropping documents', async () => {
    scan.mockRejectedValueOnce(new Error('Folder no longer exists'));
    await act(async () => { tree = create(<FolderTreeSection rootPath="/paper" />); });
    expect(button('paper')).toBeDefined();
    expect(text(tree.root)).toContain('Folder no longer exists');
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });
  it.each([
    ['markdown', '# Parent\n## Child\n### Grandchild\n# Next'],
    ['latex', '\\chapter{Parent}\n\\section{Child}\n\\subsection{Grandchild}\n\\chapter{Next}'],
    ['typst', '= Parent\n== Child\n=== Grandchild\n= Next'],
  ] as const)('groups and folds %s chapters without losing source navigation', async (lang, content) => {
    const jump = vi.fn();
    useTabsStore.getState().patchTab('draft', { lang, content });
    await act(async () => { tree = create(<OutlineSection onJumpTo={jump} />); });
    const row = (title: string, line: number) => button(lang === 'markdown' ? title : `${title}L${line}`)!;
    const parent = row('Parent', 1).parent!.parent!;
    const child = row('Child', 2).parent!.parent!;
    expect(parent.findAllByType('li')).toContain(child);
    expect(child.findAllByType('li')).toContain(row('Grandchild', 3).parent!.parent!);
    expect(parent.findAllByType('li')).not.toContain(row('Next', 4).parent!.parent!);
    const toggle = tree.root.findByProps({ 'aria-label': 'Parent', 'aria-expanded': true });
    act(() => toggle.props.onClick());
    expect(toggle.props['aria-expanded']).toBe(false);
    expect(parent.findAllByType('ul')[0].props.hidden).toBe(true);
    act(() => toggle.props.onClick());
    act(() => row('Child', 2).props.onClick());
    expect(jump).toHaveBeenCalledWith(null, 2);
  });

  it('lists LaTeX figures, tables, labels and citations, and filters a long outline', async () => {
    const sections = Array.from({ length: 8 }, (_, i) => `\\section{Part ${i + 1}}`).join('\n');
    const content = `${sections}\n\\begin{table}\\caption{Totals}\\label{tab:t}\\end{table}\nSee \\cite{knuth}.`;
    useTabsStore.getState().patchTab('draft', { lang: 'latex', content });
    const jump = vi.fn();
    await act(async () => { tree = create(<OutlineSection onJumpTo={jump} />); });
    const group = tree.root.findByProps({ 'aria-label': 'Tables', 'aria-expanded': false });
    act(() => group.props.onClick());
    act(() => button('TotalsL9')!.props.onClick());
    expect(jump).toHaveBeenCalledWith(null, 9);
    expect(text(tree.root)).toContain('Citations1');
    const filter = tree.root.findByProps({ 'aria-label': 'Filter outline' });
    act(() => filter.props.onChange({ target: { value: 'part 3' } }));
    expect(button('Part 3L3')).toBeDefined();
    expect(button('Part 4L4')).toBeUndefined();
    act(() => filter.props.onKeyDown({ key: 'Escape' }));
    expect(button('Part 4L4')).toBeDefined();
  });
});
