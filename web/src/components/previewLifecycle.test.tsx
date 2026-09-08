import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PreviewPane } from './PreviewPane';
import { Sidebar } from './Sidebar';
import { useTabsStore, useSettingsStore, defaultSettings } from '../store';
import { ipc, type TypstResult } from '../api/tauri';
import { useProjectStore } from '../store';
import { markdownWithMath } from '../render/markdown';

vi.mock('../api/tauri', () => ({ hasTauri: () => true, ipc: { compileTypst: vi.fn() }, dialogConfirm: vi.fn() }));
const preview = (svg: string): TypstResult => ({ ok: true, pages: [{ svg, svgHash: svg, width: 100, height: 100, points: [], text: [], links: [] }], diagnostics: [], missingPackages: [], dependencies: [] });
vi.mock('../render/markdown', () => ({ markdownWithMath: vi.fn((source: string) => `<p>${source}</p>`) }));
let tree: ReactTestRenderer | undefined;
const mount = (element: React.ReactElement) => act(() => { tree = create(element); });
const advance = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(250); }); };
const updateTab = (content: string) => act(() => useTabsStore.getState().patchTab('one', { content }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(ipc.compileTypst).mockResolvedValue(preview('<svg>latest</svg>'));
  useProjectStore.getState().reset();
  useSettingsStore.setState({ settings: defaultSettings });
  useTabsStore.setState({ activeTabId: 'one', tabs: [{ id: 'one', title: 'one.md', lang: 'markdown', content: 'first', filePath: null, isDirty: false }] });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.useRealTimers();
});

describe('preview lifecycle without a browser', () => {
  it('does not render Markdown while hidden and resumes with only the latest text', async () => {
    mount(<PreviewPane visible={false} />);
    updateTab('second');
    await advance();
    expect(markdownWithMath).not.toHaveBeenCalled();
    act(() => tree!.update(<PreviewPane visible />));
    await advance();
    expect(markdownWithMath).toHaveBeenCalledTimes(1);
    expect(markdownWithMath).toHaveBeenLastCalledWith('second');
    act(() => tree!.update(<PreviewPane visible={false} />));
    updateTab('third');
    await advance();
    expect(markdownWithMath).toHaveBeenCalledTimes(1);
    act(() => tree!.update(<PreviewPane visible />));
    await advance();
    expect(markdownWithMath).toHaveBeenLastCalledWith('third');
  });

  it('clears a pending debounce on hide', async () => {
    mount(<PreviewPane visible />);
    act(() => tree!.update(<PreviewPane visible={false} />));
    await advance();
    expect(markdownWithMath).not.toHaveBeenCalled();
  });

  it('serializes Typst updates and never displays stale output', async () => {
    let resolve!: (result: TypstResult) => void;
    vi.mocked(ipc.compileTypst).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    useTabsStore.getState().patchTab('one', { lang: 'typst', filePath: '/p/main.typ' });
    mount(<PreviewPane visible />);
    await advance();
    updateTab('second');
    await advance();
    updateTab('third');
    await advance();
    expect(ipc.compileTypst).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(preview('<svg>stale</svg>')); });
    expect(ipc.compileTypst).toHaveBeenCalledTimes(2);
    expect(ipc.compileTypst).toHaveBeenLastCalledWith('third', '/p/main.typ', expect.objectContaining({ root: '/p' }));
    expect(JSON.stringify(tree!.toJSON())).not.toContain('<svg>stale</svg>');
    expect(JSON.stringify(tree!.toJSON())).toContain('<svg>latest</svg>');
  });

  it('ignores an in-flight result after hide and refreshes unchanged Typst on reopen', async () => {
    let resolve!: (result: TypstResult) => void;
    vi.mocked(ipc.compileTypst).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    useTabsStore.getState().patchTab('one', { lang: 'typst' });
    mount(<PreviewPane visible />);
    await advance();
    act(() => tree!.update(<PreviewPane visible={false} />));
    await act(async () => { resolve(preview('<svg>hidden</svg>')); });
    expect(JSON.stringify(tree!.toJSON())).not.toContain('<svg>hidden</svg>');
    act(() => tree!.update(<PreviewPane visible />));
    await advance();
    expect(ipc.compileTypst).toHaveBeenCalledTimes(2);
  });

  it('retains the last good Typst pages on failure with explicit stale status', async () => {
    useTabsStore.getState().patchTab('one', { lang: 'typst' });
    mount(<PreviewPane visible />);
    await advance();
    vi.mocked(ipc.compileTypst).mockResolvedValue({ ok: false, pages: [], diagnostics: [{ file: null, line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'error', message: 'bad source', hints: [] }], missingPackages: [], dependencies: [] });
    updateTab('#missing()');
    await advance();
    const content = JSON.stringify(tree!.toJSON());
    expect(content).toContain('<svg>latest</svg>');
    expect(content).toContain('Preview not updated');
    expect(content).toContain('bad source');
  });

  it('reuses only the acknowledged SVG while accepting fresh text/source positions', async () => {
    useTabsStore.getState().patchTab('one', { lang: 'typst', filePath: '/p/main.typ' });
    mount(<PreviewPane visible />); await advance();
    const next = preview('<svg>latest</svg>'); next.pages[0].svg = ''; next.pages[0].text = [{ text: 'new reading text', size: 12, width: 100, matrix: [1,0,0,1,0,12] }];
    vi.mocked(ipc.compileTypst).mockResolvedValue(next); updateTab('changed'); await advance();
    expect(ipc.compileTypst).toHaveBeenLastCalledWith('changed', '/p/main.typ', expect.objectContaining({ knownSvg: ['<svg>latest</svg>'] }));
    expect(JSON.stringify(tree!.toJSON())).toContain('<svg>latest</svg>');
    expect(JSON.stringify(tree!.toJSON())).toContain('new reading text');
  });

  it('does not compile another project when an unrelated tab changes', async () => {
    useTabsStore.getState().patchTab('one', { lang: 'typst', filePath: '/p/main.typ' });
    useTabsStore.getState().setTabs([...useTabsStore.getState().tabs, { id: 'unrelated', filePath: '/other/a.typ', content: 'other', lang: 'typst', title: 'other', isDirty: false }]);
    mount(<PreviewPane visible />); await advance();
    const calls = vi.mocked(ipc.compileTypst).mock.calls.length;
    act(() => useTabsStore.getState().patchTab('unrelated', { content: 'unrelated edit' })); await advance();
    expect(ipc.compileTypst).toHaveBeenCalledTimes(calls);
  });

  it('does not display the previous document during a tab-switch debounce', async () => {
    mount(<PreviewPane visible />);
    await advance();
    act(() => useTabsStore.getState().addTab({ id: 'two', title: 'two.md', lang: 'markdown', content: 'other', filePath: null, isDirty: false }));
    expect(JSON.stringify(tree!.toJSON())).not.toContain('<p>first</p>');
    await advance();
    expect(JSON.stringify(tree!.toJSON())).toContain('<p>other</p>');
  });
});

describe('workspace visibility lifecycle', () => {
  it('retains the selected view, collapsed section and child instance across hide/show', () => {
    const props = { bibliography: <div>Bibliography content</div> };
    mount(<Sidebar {...props} />);
    const research = () => tree!.root.findAllByProps({ role: 'tab' })[1];
    act(() => research().props.onClick());
    const section = () => tree!.root.findAllByType('button').find(button => button.props['aria-expanded'] !== undefined)!;
    act(() => section().props.onClick());
    const child = tree!.root.findByProps({ children: 'Bibliography content' });
    act(() => tree!.update(<Sidebar {...props} hidden />));
    expect(tree!.root.findByType('aside').props.hidden).toBe(true);
    act(() => tree!.update(<Sidebar {...props} hidden={false} />));
    expect(research().props['aria-selected']).toBe(true);
    expect(section().props['aria-expanded']).toBe(false);
    expect(tree!.root.findByProps({ children: 'Bibliography content' })).toBe(child);
  });
});
