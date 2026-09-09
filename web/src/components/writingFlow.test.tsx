import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toolbar, type ToolbarProps } from './Toolbar';
import { Sidebar } from './Sidebar';
import { StartActions } from './StartActions';
import { WriterDialog, type WriterDialogProps } from './WriterDialog';
import { useTabsStore, usePdfStore, useCompileStore, useSettingsStore, defaultSettings } from '../store';
import { createTemplate, dialogOpen, ipc } from '../api/tauri';
import { openFileByPath } from '../files/files';

vi.mock('../api/tauri', () => ({
  hasTauri: () => false,
  createTemplate: vi.fn(), dialogOpen: vi.fn(),
  ipc: { detectLatexEngines: vi.fn(), detectBibEngines: vi.fn() },
}));
vi.mock('../files/files', () => ({ openFileByPath: vi.fn() }));
let tree: ReactTestRenderer;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
const button = (label: string) => tree.root.findAllByType('button').find(node => node.props['aria-label'] === label || node.children.includes(label) || text(node).trim() === label)!;
const rendered = () => JSON.stringify(tree.toJSON());
const props: ToolbarProps = {
  lang: 'markdown', onLangChange: vi.fn(), layout: 'split', onLayoutChange: vi.fn(),
  focusMode: false, onToggleFocus: vi.fn(), sidebarVisible: true, onToggleSidebar: vi.fn(),
  onWriterTool: vi.fn(), onExportLatexPdf: vi.fn(), onExportTypstPdf: vi.fn(), onOpenFile: vi.fn(),
};
const listeners = new Map<string, (event: unknown) => void>();
beforeEach(() => {
  vi.resetAllMocks(); listeners.clear();
  vi.stubGlobal('document', {
    activeElement: { focus: vi.fn() },
    addEventListener: (key: string, fn: (event: unknown) => void) => listeners.set(key, fn),
    removeEventListener: (key: string) => listeners.delete(key),
  });
  useSettingsStore.setState({ settings: { ...defaultSettings, ui_language: 'en' } });
  useTabsStore.setState({ activeTabId: 'one', tabs: [{ id: 'one', lang: 'markdown', filePath: null, title: 'Untitled.md', content: '', isDirty: false }] });
  useCompileStore.setState({ status: 'idle' });
  usePdfStore.setState({ ownerTabId: null, sourceRoot: null, sourceFiles: [], bytes: null, workdirToken: null, stale: false });
  vi.mocked(ipc.detectLatexEngines).mockResolvedValue([{ name: 'pdflatex', path: null, version: null }]);
  vi.mocked(ipc.detectBibEngines).mockResolvedValue([]);
  vi.mocked(dialogOpen).mockResolvedValue('/papers');
  vi.mocked(createTemplate).mockResolvedValue('/papers/My paper/main.typ');
  vi.mocked(openFileByPath).mockResolvedValue(true);
});
afterEach(() => { act(() => tree?.unmount()); vi.unstubAllGlobals(); });

function toolbar(lang: ToolbarProps['lang']) {
  useTabsStore.getState().patchTab('one', { lang });
  act(() => { tree = create(<Toolbar {...props} lang={lang} />); });
}

describe('task-oriented toolbar', () => {
  it('keeps New visible and TeX tools absent for Markdown', () => {
    toolbar('markdown');
    act(() => button('New document').props.onClick());
    expect(props.onWriterTool).toHaveBeenCalledWith('templates');
    expect(button('Typesetting')).toBeUndefined();
    expect(button('Export PDF')).toBeUndefined();
    act(() => button('Document tools').props.onClick());
    expect(rendered()).not.toContain('Check environment');
    expect(rendered()).not.toContain('Quick preview');
    expect(button('Local version timeline…')).toBeDefined();
    act(() => button('Open file').props.onClick());
    expect(props.onOpenFile).toHaveBeenCalledOnce();
    expect(button('Document tools').props['aria-expanded']).toBe(false);
  });
  it('separates typesetting from file operations and folds advanced builds', () => {
    toolbar('latex');
    act(() => button('Typesetting').props.onClick());
    expect(button('Check environment…')).toBeDefined();
    expect(button('Open file')).toBeUndefined();
    expect(tree.root.findByType('details').props.open).toBeUndefined();
    expect(text(tree.root.findByType('summary'))).toBe('Build options');
    expect(button('Set as project main').props.disabled).toBe(true);
    act(() => button('Document tools').props.onClick());
    expect(button('Typesetting').props['aria-expanded']).toBe(false);
    expect(button('Check environment…')).toBeUndefined();
  });
  it('only enables LaTeX export for the current fresh PDF', () => {
    toolbar('latex');
    expect(button('Export PDF').props.disabled).toBe(true);
    expect(button('Export PDF').props.title).toBe('Compile to export PDF');
    act(() => usePdfStore.setState({ ownerTabId: 'one', bytes: new Uint8Array([1]), workdirToken: 'work', stale: false }));
    expect(button('Export PDF').props.disabled).toBe(false);
    act(() => button('Export PDF').props.onClick());
    expect(props.onExportLatexPdf).toHaveBeenCalledOnce();
    act(() => usePdfStore.setState({ stale: true }));
    expect(button('Export PDF').props.disabled).toBe(true);
    act(() => usePdfStore.setState({ stale: false, ownerTabId: 'other' }));
    expect(button('Export PDF').props.disabled).toBe(true);
  });
  it('exports Typst directly without displaying TeX engine controls', () => {
    toolbar('typst');
    expect(button('Export PDF').props.disabled).toBe(false);
    act(() => button('Export PDF').props.onClick());
    expect(props.onExportTypstPdf).toHaveBeenCalledOnce();
    act(() => button('Typesetting').props.onClick());
    expect(tree.root.findAllByType('select')).toHaveLength(0);
    expect(button('Compile')).toBeUndefined();
    expect(button('Jump to preview')).toBeDefined();
  });
  it('Escape closes the open menu and consumes the key', () => {
    toolbar('latex');
    act(() => button('Typesetting').props.onClick());
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => listeners.get('keydown')!(event));
    expect(button('Typesetting').props['aria-expanded']).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
  it('closes a typesetting menu when switching to a note', () => {
    toolbar('latex');
    act(() => button('Typesetting').props.onClick());
    act(() => tree.update(<Toolbar {...props} />));
    expect(button('Document tools').props['aria-expanded']).toBe(false);
    expect(button('Typesetting')).toBeUndefined();
  });
});

describe('contextual sidebar and start actions', () => {
  it('uses labelled icons without a visible workspace heading or text tabs', () => {
    act(() => { tree = create(<Sidebar />); });
    const tabs = tree.root.findAllByProps({ role: 'tab' });
    expect(tabs.map(node => node.props['aria-label'])).toEqual(['Document', 'Research']);
    for (const tab of tabs) {
      expect(text(tab)).toBe('');
      expect(tab.props.title).toBe(tab.props['aria-label']);
      expect(tab.findByType('svg').props['aria-hidden']).toBe('true');
    }
    expect(tree.root.findAllByType('div').some(node => node.children.includes('Workspace'))).toBe(false);
  });
  it('groups writing with the document and keeps project tools collapsed', () => {
    act(() => { tree = create(<Sidebar folderTree={<p>Folder tree</p>} files={<p>Dependencies</p>} writing={<p>Checks</p>} git={<p>Git</p>} artifacts={<p>Outputs</p>} />); });
    expect(button('Folder')).toBeUndefined();
    expect(button('Included files').props['aria-expanded']).toBe(false);
    expect(button('Writing checks').props['aria-expanded']).toBe(false);
    expect(button('Build outputs').props['aria-expanded']).toBe(false);
    expect(button('Version control').props['aria-expanded']).toBe(false);
    expect(tree.root.findAllByProps({ role: 'tab' }).map(node => node.props['aria-label'])).toEqual(['Document', 'Research', 'Project']);
  });
  it('keeps Research selected when folder content disappears and offers Open folder', () => {
    const open = vi.fn();
    act(() => { tree = create(<Sidebar bibliography={<p>Citations</p>} onOpenFolder={open} />); });
    act(() => button('Research').props.onClick());
    act(() => tree.update(<Sidebar onOpenFolder={open} />));
    expect(button('Research').props['aria-selected']).toBe(true);
    const panel = tree.root.findByProps({ id: button('Research').props['aria-controls'] });
    expect(panel.props.hidden).toBe(false);
    expect(text(panel)).toContain('Open a folder to browse');
    act(() => button('Open folder').props.onClick());
    expect(open).toHaveBeenCalledOnce();
    act(() => tree.update(<Sidebar bibliography={<p>Citations</p>} />));
    expect(button('Research').props['aria-selected']).toBe(true);
    expect(button('Open folder')).toBeUndefined();
  });
  it('navigates icons with arrow keys, Home and End and links every panel', () => {
    const focus = vi.fn();
    act(() => { tree = create(<Sidebar git={<p>Git</p>} />, { createNodeMock: () => ({ focus }) }); });
    for (const [from, key, target] of [
      ['Document', 'ArrowRight', 'Research'], ['Research', 'End', 'Project'],
      ['Project', 'ArrowRight', 'Document'], ['Document', 'ArrowLeft', 'Project'],
      ['Project', 'Home', 'Document'],
    ]) {
      const event = { key, preventDefault: vi.fn() };
      act(() => button(from).props.onKeyDown(event));
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(button(target).props['aria-selected']).toBe(true);
      expect(button(target).props.tabIndex).toBe(0);
      const panel = tree.root.findByProps({ id: button(target).props['aria-controls'] });
      expect(panel.props['aria-labelledby']).toBe(button(target).props.id);
      expect(panel.props.hidden).toBe(false);
      expect(tree.root.findAllByProps({ role: 'tab' }).filter(node => node.props.tabIndex === 0)).toHaveLength(1);
    }
    expect(focus).toHaveBeenCalledTimes(5);
  });
  it('falls back to Document when contextual Project tools disappear', () => {
    act(() => { tree = create(<Sidebar git={<p>Git</p>} />); });
    act(() => button('Project').props.onClick());
    act(() => tree.update(<Sidebar />));
    expect(button('Document').props['aria-selected']).toBe(true);
    expect(button('Research')).toBeDefined();
    expect(button('Project')).toBeUndefined();
  });
  it('localizes icon labels and keeps a hidden sidebar out of the layout', () => {
    useSettingsStore.setState({ settings: { ...defaultSettings, ui_language: 'zh-CN' } });
    act(() => { tree = create(<Sidebar hidden width={220} />); });
    expect(tree.root.findAllByProps({ role: 'tab' }).map(node => node.props['aria-label'])).toEqual(['文档', '研究']);
    expect(button('研究').props.title).toBe('研究');
    expect(tree.root.findByType('aside').props).toMatchObject({ hidden: true, style: { width: '220px' } });
  });
  it('offers direct start actions, not a welcome slogan or modal', () => {
    const handlers = { onOpen: vi.fn(), onFolder: vi.fn(), onNew: vi.fn(), onDismiss: vi.fn() };
    act(() => { tree = create(<StartActions {...handlers} />); });
    for (const [label, fn] of [['Open file', handlers.onOpen], ['Open folder', handlers.onFolder], ['New from template…', handlers.onNew], ['Dismiss start actions', handlers.onDismiss]] as const) {
      act(() => button(label).props.onClick()); expect(fn).toHaveBeenCalledOnce();
    }
    expect(tree.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
  });
});

const close = vi.fn();
const mountWriter = async (extra: Partial<WriterDialogProps> = {}) => {
  await act(async () => { tree = create(<WriterDialog tool="templates" onClose={close} {...extra} />); });
};
const chooseLatex = async () => {
  await act(async () => { tree.root.findAllByType('button').find(node => node.findAllByType('strong').some(strong => text(strong) === 'LaTeX paper'))!.props.onClick(); });
};

describe('new document path', () => {
  it('does not probe TeX for Typst, and opens the workspace after the generated main', async () => {
    const created = vi.fn(async () => {});
    await mountWriter({ onCreated: created });
    expect(ipc.detectLatexEngines).not.toHaveBeenCalled();
    await act(async () => { button('Choose location and create…').props.onClick(); });
    expect(openFileByPath).toHaveBeenCalledWith('/papers/My paper/main.typ');
    expect(created).toHaveBeenCalledWith('/papers/My paper/main.typ');
    expect(created.mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(openFileByPath).mock.invocationCallOrder[0]);
    expect(close).toHaveBeenCalledOnce();
  });
  it('reports missing TeX but still allows creating the draft', async () => {
    await mountWriter(); await chooseLatex();
    expect(rendered()).toContain('pdflatex was not found');
    expect(button('Choose location and create…').props.disabled).toBe(false);
    await act(async () => { button('Choose location and create…').props.onClick(); });
    expect(createTemplate).toHaveBeenCalledWith('/papers', 'My paper', 'latex-paper');
  });
  it('does not misreport pending or failed detection as missing; retry works', async () => {
    let reject!: (e: Error) => void;
    vi.mocked(ipc.detectLatexEngines).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await mountWriter(); await chooseLatex();
    expect(rendered()).toContain('Checking local TeX tools');
    expect(rendered()).not.toContain('pdflatex was not found');
    await act(async () => reject(new Error('IPC failed')));
    expect(rendered()).toContain('Could not check TeX tools');
    expect(rendered()).not.toContain('pdflatex was not found');
    vi.mocked(ipc.detectLatexEngines).mockResolvedValue([{ name: 'pdflatex', path: '/custom/pdflatex', version: null }]);
    await act(async () => button('Check again').props.onClick());
    expect(rendered()).toContain('pdflatex is available');
  });
  it('retains the chosen template and folder name across settings and rechecks afterward', async () => {
    await mountWriter(); await chooseLatex();
    act(() => tree.root.findByType('input').props.onChange({ target: { value: 'My thesis' } }));
    act(() => tree.update(<WriterDialog tool="templates" onClose={close} hidden />));
    expect(tree.root.findAllByType('div').some(node => node.props.hidden)).toBe(true);
    await act(async () => tree.update(<WriterDialog tool="templates" onClose={close} />));
    expect(tree.root.findByType('input').props.value).toBe('My thesis');
    expect(ipc.detectLatexEngines).toHaveBeenCalledTimes(2);
    await act(async () => button('Choose location and create…').props.onClick());
    expect(createTemplate).toHaveBeenCalledWith('/papers', 'My thesis', 'latex-paper');
  });
  it('keeps a failed main-document open from pretending creation completed', async () => {
    const created = vi.fn(async () => {});
    vi.mocked(openFileByPath).mockResolvedValue(false);
    await mountWriter({ onCreated: created });
    await act(async () => button('Choose location and create…').props.onClick());
    expect(created).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(rendered()).toContain('Project created, but could not open');
  });
  it('blank note bypasses the folder picker and template creation', async () => {
    const blank = vi.fn();
    await mountWriter({ onBlank: blank });
    act(() => button('Blank note').props.onClick());
    expect(blank).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
    expect(dialogOpen).not.toHaveBeenCalled(); expect(createTemplate).not.toHaveBeenCalled();
  });
});
