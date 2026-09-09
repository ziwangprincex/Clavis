import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { resolveLocale, translate } from './index';
import { CommandPalette } from '../components/CommandPalette';
import { Sidebar } from '../components/Sidebar';
import { defaultSettings, useSettingsStore } from '../store/settings';
import { useCommandsStore } from '../store/commands';
import { IconCommandPalette } from '../components/icons';
let tree: ReactTestRenderer | undefined;
afterEach(() => { act(() => tree?.unmount()); tree = undefined; useSettingsStore.setState({ settings: defaultSettings }); useCommandsStore.setState({ commands: new Map() }); vi.unstubAllGlobals(); });
describe('language selection', () => {
  it('follows Chinese OS locale, with explicit English taking priority', () => {
    expect(resolveLocale('auto', 'zh-CN')).toBe('zh-CN');
    expect(resolveLocale('auto', 'zh-TW')).toBe('zh-CN');
    expect(resolveLocale('en', 'zh-CN')).toBe('en');
    expect(resolveLocale('zh-CN', 'en-US')).toBe('zh-CN');
    expect(resolveLocale('auto', 'en-US')).toBe('en');
  });
  it('substitutes complete phrases without translating paths or document text', () => {
    expect(translate('zh-CN', 'Close {name}', { name: '/p/Read.md' })).toBe('关闭 /p/Read.md');
    expect(translate('zh-CN', 'My research text')).toBe('My research text');
    expect(translate('en', 'Settings')).toBe('Settings');
  });
  it('Chinese command search also accepts original English labels', () => {
    vi.stubGlobal('document', { activeElement: null });
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => { f(); return 1; });
    useSettingsStore.setState({ settings: { ...defaultSettings, ui_language: 'zh-CN' } });
    const run = vi.fn();
    useCommandsStore.getState().register({ id: 'settings', name: 'Open settings', run });
    useCommandsStore.getState().register({ id: 'save', name: 'Save', run: vi.fn() });
    act(() => { tree = create(<CommandPalette open onClose={() => {}} />); });
    for (const query of ['设置', 'settings']) {
      act(() => tree!.root.findByType('input').props.onChange({ target: { value: query } }));
      expect(tree!.root.findAllByType('li')).toHaveLength(1);
      expect(JSON.stringify(tree!.toJSON())).toContain('打开设置');
    }
    act(() => tree!.root.findByType('input').props.onKeyDown({ key: 'Enter', preventDefault() {} }));
    expect(run).toHaveBeenCalledOnce();
  });
  it('translates sidebar navigation without altering user content', () => {
    useSettingsStore.setState({ settings: { ...defaultSettings, ui_language: 'zh-CN' } });
    act(() => { tree = create(<Sidebar outline={<span>My title</span>} />); });
    const tabs = tree!.root.findAllByProps({ role: 'tab' });
    expect(tabs.map(tab => tab.props['aria-label'])).toEqual(['文档', '研究']);
    expect(tabs.map(tab => tab.props.title)).toEqual(['文档', '研究']);
    expect(JSON.stringify(tree!.toJSON())).toContain('My title');
  });
  it('uses a neutral command list icon, not a macOS Command key', () => {
    act(() => { tree = create(<IconCommandPalette />); });
    expect(tree!.root.findAllByType('rect')).toHaveLength(1);
    expect(tree!.root.findByType('path').props.d).toBe('m4.5 6 2 2-2 2M9 6h2.5M9 10h2.5');
  });
});
