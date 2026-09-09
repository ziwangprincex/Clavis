import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ipc } from '../api/tauri';
import { useProjectStore, useTabsStore, useSettingsStore, defaultSettings } from '../store';
import { restoreSession, flushSessionSave } from '../files/session';
import { encodeSessionSnapshot } from '../files/sessionModel';
import { useSessionPersistence } from './useSessionPersistence';

vi.mock('../api/tauri', () => ({ hasTauri: () => true, ipc: { loadSession: vi.fn(), saveSession: vi.fn() } }));
vi.mock('../files/documentSync', () => ({ checkExternalDocuments: vi.fn(async () => {}) }));
let tree: ReactTestRenderer;
function Harness({ ready = true }: { ready?: boolean }) { useSessionPersistence(false, ready); return null; }
const tab = { id: 'main', title: 'main.tex', filePath: '/paper/main.tex', lang: 'latex' as const, content: 'unsaved paper', isDirty: true };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal('window', new EventTarget());
  useProjectStore.getState().reset();
  useTabsStore.setState({ tabs: [tab], activeTabId: tab.id });
  useSettingsStore.setState({ settings: { ...defaultSettings, autosave_enabled: false } });
  vi.mocked(ipc.saveSession).mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => tree?.unmount());
  flushSessionSave();
  vi.useRealTimers(); vi.unstubAllGlobals();
});
const saved = () => JSON.parse(vi.mocked(ipc.saveSession).mock.lastCall![0]);

it('round-trips the explicit folder independently of the active file, preserving unsaved work', async () => {
  useProjectStore.getState().setProject({ folderPath: '/paper' });
  flushSessionSave();
  vi.mocked(ipc.loadSession).mockResolvedValue(vi.mocked(ipc.saveSession).mock.lastCall![0]);
  useProjectStore.getState().reset();
  useTabsStore.setState({ tabs: [], activeTabId: null });
  expect(await restoreSession()).toBe(true);
  expect(useProjectStore.getState().folderPath).toBe('/paper');
  expect(useTabsStore.getState().tabs).toHaveLength(1);
  expect(useTabsStore.getState().tabs[0]).toMatchObject({ filePath: '/paper/main.tex', content: 'unsaved paper', isDirty: true });
});

it('persists opening and explicitly closing a folder without editing any tab', async () => {
  act(() => { tree = create(<Harness />); });
  act(() => useProjectStore.getState().setProject({ folderPath: '/paper' }));
  await vi.advanceTimersByTimeAsync(800);
  expect(saved().folderPath).toBe('/paper');
  act(() => useProjectStore.getState().setProject({ folderPath: null }));
  await vi.advanceTimersByTimeAsync(800);
  expect(saved().folderPath).toBeNull();
  expect(saved().tabs[0].content).toBe('unsaved paper');
  vi.mocked(ipc.loadSession).mockResolvedValue(vi.mocked(ipc.saveSession).mock.lastCall![0]);
  expect(await restoreSession()).toBe(true);
  expect(useProjectStore.getState().folderPath).toBeNull();
});

it('flushes the latest folder on window close even before the debounce completes', () => {
  act(() => { tree = create(<Harness />); });
  act(() => useProjectStore.getState().setProject({ folderPath: '/paper' }));
  window.dispatchEvent(new Event('beforeunload'));
  expect(saved().folderPath).toBe('/paper');
  expect(saved().tabs).toHaveLength(1);
});

it('does not overwrite recovery data while boot restoration is pending', async () => {
  act(() => { tree = create(<Harness ready={false} />); });
  act(() => useProjectStore.getState().setProject({ folderPath: '/paper' }));
  await vi.advanceTimersByTimeAsync(1000);
  window.dispatchEvent(new Event('beforeunload'));
  expect(ipc.saveSession).not.toHaveBeenCalled();
  act(() => tree.update(<Harness ready />));
  await vi.advanceTimersByTimeAsync(800);
  expect(saved().folderPath).toBe('/paper');
});

it('restores an open folder even if every document tab had been closed', async () => {
  vi.mocked(ipc.loadSession).mockResolvedValue(encodeSessionSnapshot([], null, '/paper'));
  expect(await restoreSession()).toBe(false);
  expect(useTabsStore.getState().tabs).toEqual([]);
  expect(useProjectStore.getState().folderPath).toBe('/paper');
});

it('never infers a folder from an old file-only session', async () => {
  vi.mocked(ipc.loadSession).mockResolvedValue(JSON.stringify({ version: 1, tabs: [tab], activeIndex: 0 }));
  expect(await restoreSession()).toBe(true);
  expect(useProjectStore.getState().folderPath).toBeNull();
});
