import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { WriterDialog } from './WriterDialog';
import { useTabsStore } from '../store/tabs';
import { createTemplate, dialogOpen, history, ipc } from '../api/tauri';
import { openFileByPath } from '../files/files';
vi.mock('../api/tauri', () => ({
  createTemplate: vi.fn(),
  dialogOpen: vi.fn(),
  history: { list: vi.fn(), read: vi.fn(), checkpoint: vi.fn() },
  ipc: { detectLatexEngines: vi.fn(), detectBibEngines: vi.fn() },
}));
vi.mock('../files/files', () => ({ openFileByPath: vi.fn() }));
let tree: ReactTestRenderer;
const close = vi.fn();
const button = (label: string) =>
  tree.root.findAllByType('button').find((b) => b.children.join('') === label)!;
const mount = async (tool: 'history' | 'templates' | 'environment') => {
  await act(async () => {
    tree = create(<WriterDialog tool={tool} onClose={close} />);
  });
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('document', { activeElement: { focus: vi.fn() } });
  vi.mocked(history.list).mockResolvedValue([{ id: 'v1', timestamp: 1234, bytes: 12 }]);
  vi.mocked(history.read).mockResolvedValue('old version');
  vi.mocked(history.checkpoint).mockResolvedValue();
  useTabsStore.setState({
    activeTabId: 'a',
    tabs: [
      {
        id: 'a',
        title: 'a.typ',
        filePath: '/p/a.typ',
        content: 'latest writing',
        lang: 'typst',
        isDirty: true,
        diskRevision: 'base',
      },
    ],
  });
});
afterEach(() => {
  act(() => tree?.unmount());
  vi.unstubAllGlobals();
});
async function selectVersion() {
  const version = tree.root.findAllByType('button').find((b) => b.props['aria-pressed'] !== undefined)!;
  await act(async () => {
    version.props.onClick();
  });
}
describe('writer tools', () => {
  it('restores into the buffer only after checkpointing the latest draft', async () => {
    await mount('history');
    await selectVersion();
    await act(async () => {
      button('Restore into editor').props.onClick();
    });
    expect(history.checkpoint).toHaveBeenCalledWith('/p/a.typ', 'latest writing');
    expect(useTabsStore.getState().tabs[0]).toMatchObject({
      content: 'old version',
      isDirty: true,
      diskRevision: 'base',
    });
    expect(useTabsStore.getState().tabs[1].content).toBe('latest writing');
    expect(close).toHaveBeenCalled();
  });
  it('does not replace a buffer when the checkpoint fails', async () => {
    vi.mocked(history.checkpoint).mockRejectedValue(new Error('disk full'));
    await mount('history');
    await selectVersion();
    await act(async () => {
      button('Restore into editor').props.onClick();
    });
    expect(useTabsStore.getState().tabs[0].content).toBe('latest writing');
    expect(close).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('disk full');
  });
  it('opens historical copies as new scratch tabs without touching the original', async () => {
    await mount('history');
    await selectVersion();
    act(() => button('Open as copy').props.onClick());
    expect(useTabsStore.getState().tabs[0].content).toBe('latest writing');
    expect(useTabsStore.getState().tabs[1]).toMatchObject({
      content: 'old version',
      filePath: null,
      isDirty: true,
    });
  });
  it('keeps creation inside the chosen parent and opens the generated main', async () => {
    vi.mocked(dialogOpen).mockResolvedValue('/papers');
    vi.mocked(createTemplate).mockResolvedValue('/papers/My paper/main.typ');
    vi.mocked(openFileByPath).mockResolvedValue(true);
    await mount('templates');
    await act(async () => {
      button('Choose location and create…').props.onClick();
    });
    expect(createTemplate).toHaveBeenCalledWith('/papers', 'My paper', 'typst-paper');
    expect(openFileByPath).toHaveBeenCalledWith('/papers/My paper/main.typ');
  });
  it('cancelling the folder picker creates nothing', async () => {
    vi.mocked(dialogOpen).mockResolvedValue(null);
    await mount('templates');
    await act(async () => {
      button('Choose location and create…').props.onClick();
    });
    expect(createTemplate).not.toHaveBeenCalled();
  });
  it('checks engines without requiring an existing workspace', async () => {
    vi.mocked(ipc.detectLatexEngines).mockResolvedValue([{ name: 'pdflatex', path: null, version: null }]);
    vi.mocked(ipc.detectBibEngines).mockResolvedValue([]);
    await mount('environment');
    expect(JSON.stringify(tree.toJSON())).toContain('Not found');
    expect(JSON.stringify(tree.toJSON())).toContain('bundled');
  });
});
