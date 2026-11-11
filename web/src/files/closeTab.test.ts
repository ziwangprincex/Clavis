import { beforeEach, expect, it, vi } from 'vitest';
import { closeActiveTab } from './closeTab';
import { useTabsStore, type Tab } from '../store/tabs';
import { appWindow, dialogConfirm, ipc } from '../api/tauri';

vi.mock('../i18n', () => ({ t: (text: string) => text }));
vi.mock('../api/tauri', () => ({
  hasTauri: () => true, dialogConfirm: vi.fn(),
  appWindow: { close: vi.fn(async () => {}) }, ipc: { closeWindow: vi.fn(async () => {}) },
}));

const tab = (over: Partial<Tab>): Tab => ({ id: 'a', title: 'a.md', filePath: '/p/a.md', lang: 'markdown', content: '', isDirty: false, ...over });
const ids = () => useTabsStore.getState().tabs.map(t => t.id);

beforeEach(() => {
  vi.clearAllMocks();
  useTabsStore.setState({ tabs: [tab({ id: 'a' }), tab({ id: 'b', isDirty: true }), tab({ id: 'c' })], activeTabId: 'a' });
});

it('closes the active tab and leaves the window open', async () => {
  await closeActiveTab();
  expect(ids()).toEqual(['b', 'c']);
  expect(useTabsStore.getState().activeTabId).toBe('b');
  expect(ipc.closeWindow).not.toHaveBeenCalled();
});

it('asks before closing an active tab with unsaved changes', async () => {
  useTabsStore.setState({ activeTabId: 'b' });
  vi.mocked(dialogConfirm).mockResolvedValue(false);
  await closeActiveTab();
  expect(ids()).toEqual(['a', 'b', 'c']);
  vi.mocked(dialogConfirm).mockResolvedValue(true);
  await closeActiveTab();
  expect(ids()).toEqual(['a', 'c']);
});

it('with no tab left closes the window through the backend', async () => {
  useTabsStore.setState({ tabs: [], activeTabId: null });
  await closeActiveTab();
  expect(ipc.closeWindow).toHaveBeenCalledOnce();
  // appWindow.close() destroys the last window without CloseRequested, which quits the app.
  expect(appWindow.close).not.toHaveBeenCalled();
});
