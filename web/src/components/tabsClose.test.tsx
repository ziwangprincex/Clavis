import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';
import { useTabsStore, type Tab } from '../store/tabs';
import { dialogConfirm } from '../api/tauri';

vi.mock('../i18n', () => ({ t: (text: string, params: Record<string, string> = {}) => text.replace(/\{(\w+)\}/g, (_, key: string) => params[key]) }));
vi.mock('../api/tauri', () => ({ hasTauri: () => true, dialogConfirm: vi.fn() }));

const tab = (over: Partial<Tab>): Tab => ({ id: 'a', title: 'a.md', filePath: '/p/a.md', lang: 'markdown', content: '', isDirty: false, ...over });
const ids = () => useTabsStore.getState().tabs.map(t => t.id);
let tree: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  // In the app Tauri replaces window.confirm with one that returns a Promise.
  vi.stubGlobal('window', { confirm: () => Promise.resolve(false) });
  useTabsStore.setState({ tabs: [tab({ id: 'a', isDirty: true }), tab({ id: 'b', filePath: '/p/b.md' })], activeTabId: 'a' });
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; vi.unstubAllGlobals(); });

async function clickClose(name: string) {
  act(() => { tree = create(<Tabs />); });
  await act(async () => { await tree!.root.findByProps({ 'aria-label': `Close ${name}` }).props.onClick({ stopPropagation() {} }); });
}

it('keeps a tab with unsaved changes when closing it is declined', async () => {
  vi.mocked(dialogConfirm).mockResolvedValue(false);
  await clickClose('a.md');
  expect(ids()).toEqual(['a', 'b']);
});

it('closes a tab with unsaved changes once closing it is confirmed', async () => {
  vi.mocked(dialogConfirm).mockResolvedValue(true);
  await clickClose('a.md');
  expect(ids()).toEqual(['b']);
});

it('closes a saved tab without asking', async () => {
  await clickClose('b.md');
  expect(ids()).toEqual(['a']);
  expect(dialogConfirm).not.toHaveBeenCalled();
});
