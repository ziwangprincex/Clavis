import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SettingsDialog } from './SettingsDialog';
import { defaultSettings, useSettingsStore } from '../store';
import { ipc } from '../api/tauri';
import { useAppTheme } from '../hooks/useAppTheme';
import { BUILTIN_THEMES } from '../theme/themes';
import { chromeTokens } from '../theme/chromeTokens';

vi.mock('../api/tauri', () => ({
  hasTauri: () => false,
  getAppVersion: vi.fn(),
  ipc: { setSettings: vi.fn().mockResolvedValue(undefined) },
}));

let tree: ReactTestRenderer | undefined;
const properties = new Map<string, string>();
const root = {
  style: {
    setProperty: (key: string, value: string) => properties.set(key, value),
    removeProperty: (key: string) => properties.delete(key),
  },
  dataset: {} as Record<string, string>,
  setAttribute: vi.fn(),
};
const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
const close = vi.fn();
const button = (text: string) => tree!.root.findAllByType('button').find(b => b.children.join('') === text)!;
const radio = (id: string) => tree!.root.findAllByType('input').find(i => i.props.type === 'radio' && i.props.value === id)!;
const mountDialog = () => act(() => { tree = create(<SettingsDialog open onClose={close} />); });

beforeEach(() => {
  vi.clearAllMocks();
  properties.clear();
  root.dataset = {};
  media.matches = false;
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('document', { documentElement: root, body: { style: {} } });
  useSettingsStore.setState({ settings: { ...defaultSettings, editor_theme: 'paper' } });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe('theme settings without a browser', () => {
  it('changes the sample immediately but only saves when asked', async () => {
    mountDialog();
    act(() => radio('ink').props.onChange());
    expect(radio('ink').props.checked).toBe(true);
    expect(useSettingsStore.getState().settings.editor_theme).toBe('paper');
    expect(ipc.setSettings).not.toHaveBeenCalled();
    await act(async () => { await button('Save').props.onClick(); });
    expect(useSettingsStore.getState().settings.editor_theme).toBe('ink');
    expect(ipc.setSettings).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cancel discards the draft and reopening restores the stored palette', () => {
    mountDialog();
    act(() => radio('dusk').props.onChange());
    act(() => button('Cancel').props.onClick());
    expect(useSettingsStore.getState().settings.editor_theme).toBe('paper');
    expect(ipc.setSettings).not.toHaveBeenCalled();
    act(() => tree!.update(<SettingsDialog open={false} onClose={close} />));
    act(() => tree!.update(<SettingsDialog open onClose={close} />));
    expect(radio('paper').props.checked).toBe(true);
    expect(radio('dusk').props.checked).toBe(false);
  });

  it('clears only colors when choosing the original palette', async () => {
    useSettingsStore.getState().patch({
      editor_theme_overrides: { bg: '#ffffff' }, ui_color_overrides: { text: '#223344' },
      ui_accent_color: '#112233', ui_font_size: 17, latex_engine: 'xelatex',
    });
    mountDialog();
    act(() => radio('mist').props.onChange());
    act(() => button('Use original palette').props.onClick());
    await act(async () => { await button('Save').props.onClick(); });
    expect(useSettingsStore.getState().settings).toMatchObject({
      editor_theme: 'mist', editor_theme_overrides: {}, ui_color_overrides: {},
      ui_accent_color: '', ui_font_size: 17, latex_engine: 'xelatex',
    });
  });

  it('keeps automatic mode and classic themes in the selector', () => {
    useSettingsStore.getState().patch({ editor_theme: 'auto' });
    mountDialog();
    const choices = tree!.root.findAllByType('option').map(o => o.props.value);
    expect(choices).toEqual(['auto', ...Object.keys(BUILTIN_THEMES)]);
    for (const id of ['paper', 'ink', 'mist', 'dusk']) expect(radio(id).props.checked).toBe(false);
    const color = tree!.root.findAllByType('input').find(i => i.props.type === 'color')!;
    expect(color.props.value).toBe(BUILTIN_THEMES.paper.accent);
    act(() => { media.matches = true; media.addEventListener.mock.calls.at(-1)![1](); });
    expect(tree!.root.findAllByType('input').find(i => i.props.type === 'color')!.props.value).toBe(BUILTIN_THEMES.ink.accent);
  });

  it('restores derived tokens after custom colors are removed', () => {
    function Harness() {
      const settings = useSettingsStore(s => s.settings);
      useAppTheme(settings);
      return null;
    }
    useSettingsStore.getState().patch({ ui_color_overrides: { bg: '#123456', selection: '#654321' }, ui_accent_color: '#aa1234' });
    act(() => { tree = create(<Harness />); });
    expect(properties.get('--bg')).toBe('#123456');
    act(() => useSettingsStore.getState().patch({ editor_theme: 'dusk', ui_color_overrides: {}, ui_accent_color: '' }));
    for (const [key, value] of Object.entries(chromeTokens(BUILTIN_THEMES.dusk))) {
      expect(properties.get(key)).toBe(value);
    }
  });
});
