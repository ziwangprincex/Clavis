import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { defaultSettings, useSettingsStore } from '../store';
import { appWindow } from '../api/tauri';
import { useAppTheme } from './useAppTheme';

vi.mock('../api/tauri', () => ({
  hasTauri: () => true,
  appWindow: { setTheme: vi.fn().mockResolvedValue(undefined) },
}));

let tree: ReactTestRenderer | undefined;
const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('document', {
    documentElement: { style: {}, setAttribute: vi.fn() },
    body: { style: {} },
    head: { append: () => {} },
    createElement: () => ({ id: '', textContent: '' }),
    getElementById: () => null,
  });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

function Probe() {
  useAppTheme(useSettingsStore(state => state.settings));
  return null;
}

it('gives the window the appearance of a chosen theme, and the system its own for auto', () => {
  // A dark theme on a light system: the window turns dark too, so the sidebar material is dark.
  useSettingsStore.setState({ settings: { ...defaultSettings, editor_theme: 'ink' } });
  act(() => { tree = create(<Probe />); });
  expect(appWindow.setTheme).toHaveBeenLastCalledWith('dark');
  act(() => useSettingsStore.setState({ settings: { ...defaultSettings, editor_theme: 'paper' } }));
  expect(appWindow.setTheme).toHaveBeenLastCalledWith('light');
  // Auto must not pin the appearance, or prefers-color-scheme would stop following the system.
  act(() => useSettingsStore.setState({ settings: { ...defaultSettings, editor_theme: 'auto' } }));
  expect(appWindow.setTheme).toHaveBeenLastCalledWith(null);
  expect(appWindow.setTheme).toHaveBeenCalledTimes(3);
});
