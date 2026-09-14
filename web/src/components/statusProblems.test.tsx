import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';
import { useCompileStore, useTabsStore, useSettingsStore, useStatusStore, defaultSettings } from '../store';

vi.mock('../i18n', () => ({ t: (text: string, values?: { count: number }) => text.replace('{count}', String(values?.count ?? '')) }));
let tree: ReactTestRenderer | undefined;
const settings = useSettingsStore.getState();
beforeEach(() => {
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  useSettingsStore.setState({ settings: { ...defaultSettings }, saveError: null });
  useTabsStore.setState({ activeTabId: 'paper', tabs: [{ id: 'paper', title: 'Untitled', filePath: null, lang: 'latex', content: '', isDirty: false }] });
  useCompileStore.getState().clearLog();
  useCompileStore.getState().setStatus('idle');
  useStatusStore.getState().set('Ready');
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  useSettingsStore.setState(settings);
  vi.unstubAllGlobals();
});

it.each([
  ['idle', 'Compile Log'],
  ['compiling', 'Compiling…'],
  ['error', 'Compile failed'],
  ['ok', 'No issues'],
] as const)('keeps the log reachable with an accurate %s label', (status, label) => {
  useCompileStore.getState().setStatus(status);
  const toggle = vi.fn();
  act(() => { tree = create(<StatusBar onToggleProblems={toggle} />); });
  const button = tree!.root.findByProps({ title: 'Toggle problems panel' });
  expect(button.children).toEqual([label]);
  act(() => button.props.onClick());
  expect(toggle).toHaveBeenCalledOnce();
});

it('shows the issue count for a successful compile with warnings', () => {
  useCompileStore.getState().setStatus('ok');
  useCompileStore.getState().setErrors([{ message: 'Rerun to get cross-references right.', kind: 'warning', line: null }]);
  act(() => { tree = create(<StatusBar />); });
  expect(tree!.root.findByProps({ title: 'Toggle problems panel' }).children).toEqual(['1 issues']);
});

it('does not expose LaTeX problems for a note', () => {
  useTabsStore.getState().patchTab('paper', { lang: 'markdown' });
  act(() => { tree = create(<StatusBar />); });
  expect(tree!.root.findAllByProps({ title: 'Toggle problems panel' })).toHaveLength(0);
});
