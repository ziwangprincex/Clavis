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
const button = (text: string) => tree!.root.findAllByType('button').find(b => b.children.join('').trim() === text)!;
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
    const themeSelect = tree!.root.findAllByType('select').find(s => s.findAllByType('option').some(o => o.props.value === 'paper'))!;
    const choices = themeSelect.findAllByType('option').map(o => o.props.value);
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


describe('safe settings behavior', () => {
  it('keeps the dialog and draft on disk failure, then allows retry', async () => {
    mountDialog();
    act(() => radio('ink').props.onChange());
    vi.mocked(ipc.setSettings).mockRejectedValueOnce(new Error('disk full'));
    await act(async () => { await button('Save').props.onClick(); });
    expect(close).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.editor_theme).toBe('paper');
    expect(radio('ink').props.checked).toBe(true);
    expect(tree!.root.findByProps({ role: 'alert' }).children.join('')).toContain('disk full');
    await act(async () => { await button('Save').props.onClick(); });
    expect(close).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().settings.editor_theme).toBe('ink');
  });

  it('Appearance reset does not clear compiler paths, recents or geometry', async () => {
    const preserved = { latex_engine: 'xelatex', latex_custom_paths: { xelatex: '/tex/xelatex' }, recent_files: ['/paper.md'], pane_editor_ratio: 0.4 };
    useSettingsStore.getState().patch({ ...preserved, ui_font_size: 20 });
    mountDialog();
    act(() => button('Reset this category').props.onClick());
    await act(async () => { await button('Save').props.onClick(); });
    expect(useSettingsStore.getState().settings).toMatchObject({ ...preserved, ui_font_size: defaultSettings.ui_font_size });
  });

  it('background settings changes do not erase the draft or get overwritten by Save', async () => {
    mountDialog();
    act(() => radio('dusk').props.onChange());
    act(() => useSettingsStore.getState().patch({ recent_files: ['/new.md'] }));
    expect(radio('dusk').props.checked).toBe(true);
    await act(async () => { await button('Save').props.onClick(); });
    expect(useSettingsStore.getState().settings).toMatchObject({ editor_theme: 'dusk', recent_files: ['/new.md'] });
  });

  it('saves Chinese preference and restores it when reopened', async () => {
    mountDialog();
    const language = tree!.root.findAllByType('select').find(s => s.findAllByType('option').some(o => o.props.value === 'zh-CN'))!;
    act(() => language.props.onChange({ target: { value: 'zh-CN' } }));
    expect(useSettingsStore.getState().settings.ui_language).toBe('auto');
    await act(async () => { await button('Save').props.onClick(); });
    expect(useSettingsStore.getState().settings.ui_language).toBe('zh-CN');
    act(() => tree!.update(<SettingsDialog open={false} onClose={close} />));
    act(() => tree!.update(<SettingsDialog open onClose={close} />));
    expect(tree!.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('设置');
  });

  it('Escape closes without saving and modal keys do not reach global shortcuts', () => {
    mountDialog();
    const modal = tree!.root.findByProps({ role: 'dialog' });
    const event = { key: 's', stopPropagation: vi.fn(), preventDefault: vi.fn(), defaultPrevented: false };
    act(() => modal.props.onKeyDown(event));
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    act(() => modal.props.onKeyDown({ ...event, key: 'Escape' }));
    expect(close).toHaveBeenCalledOnce();
    expect(ipc.setSettings).not.toHaveBeenCalled();
  });

  it('Tab and Shift+Tab stay within the dialog and focus returns on close', () => {
    const before = { focus: vi.fn() };
    const first = { focus: vi.fn(), closest: () => null, getClientRects: () => [1] };
    const last = { focus: vi.fn(), closest: () => null, getClientRects: () => [1] };
    const element = { focus: vi.fn(), querySelectorAll: () => [first, last] };
    const document = { activeElement: before };
    vi.stubGlobal('document', document);
    act(() => { tree = create(<SettingsDialog open onClose={close} />, { createNodeMock: node => node.props.role === 'dialog' ? element : null }); });
    const modal = tree!.root.findByProps({ role: 'dialog' });
    expect(element.focus).toHaveBeenCalledOnce();
    document.activeElement = last;
    const event = { key: 'Tab', shiftKey: false, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    act(() => modal.props.onKeyDown(event));
    expect(first.focus).toHaveBeenCalledOnce();
    document.activeElement = first;
    act(() => modal.props.onKeyDown({ ...event, shiftKey: true }));
    expect(last.focus).toHaveBeenCalledOnce();
    act(() => tree!.unmount()); tree = undefined;
    expect(before.focus).toHaveBeenCalledOnce();
  });
});


it('does not expose paper-surround colors, including with a legacy stored purple', () => {
  useSettingsStore.setState({ settings: { ...defaultSettings, pdf_bg_color: '#942192' } as typeof defaultSettings });
  mountDialog();
  act(() => button('LaTeX & PDF').props.onClick());
  expect(tree!.root.findAllByType('input').filter(input => input.props.type === 'color')).toHaveLength(0);
  expect(JSON.stringify(tree!.toJSON())).not.toContain('Background color');
  expect(JSON.stringify(tree!.toJSON())).not.toContain('#942192');
  expect(JSON.stringify(tree!.toJSON())).toContain('neutral gray');
});

it('shows actual inherited editor colors instead of black placeholder swatches', () => {
  mountDialog();
  act(() => button('Editor').props.onClick());
  const colors = tree!.root.findAllByType('input').filter(input => input.props.type === 'color');
  expect(colors.map(input => input.props.value)).toEqual([
    BUILTIN_THEMES.paper.bg, BUILTIN_THEMES.paper.fg, BUILTIN_THEMES.paper.gutterBg,
    BUILTIN_THEMES.paper.gutterFg, BUILTIN_THEMES.paper.activeBg, BUILTIN_THEMES.paper.cursor,
    BUILTIN_THEMES.paper.selection,
  ]);
});
