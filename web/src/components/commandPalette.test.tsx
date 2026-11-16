import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { defaultSettings, useSettingsStore } from '../store/settings';
import { useCommandsStore } from '../store/commands';

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal('document', { activeElement: null, getElementById: () => null });
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => { f(); return 1; });
  useSettingsStore.setState({ settings: { ...defaultSettings, ui_language: 'en' } });
  for (const name of ['Toggle focus mode', 'Toggle sidebar', 'Table: move row up', 'Table: delete row']) {
    useCommandsStore.getState().register({ id: name, name, run: vi.fn() });
  }
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  useSettingsStore.setState({ settings: defaultSettings });
  useCommandsStore.setState({ commands: new Map() });
  vi.unstubAllGlobals();
});

const open = () => act(() => { tree = create(<CommandPalette open onClose={() => {}} />); });
const options = () => tree!.root.findAll(node => node.props.role === 'option');
const selected = () => options().findIndex(option => option.props['aria-selected'] === true);
const input = (): ReactTestInstance => tree!.root.findByType('input');

it('keeps the first command selected when the list opens under a resting pointer', () => {
  // Regression: the item under a pointer resting mid-window became active on
  // open, so Enter ran "Table: move row up" instead of the first command.
  open();
  const row = options()[2];
  act(() => row.props.onMouseEnter?.({ clientX: 700, clientY: 444 }));
  act(() => row.props.onMouseMove?.({ clientX: 700, clientY: 444 }));
  expect(selected()).toBe(0);
  // A real move of the pointer still selects what it is over.
  act(() => row.props.onMouseMove({ clientX: 702, clientY: 446 }));
  expect(selected()).toBe(2);
});

it('tells assistive technology which command Enter will run', () => {
  open();
  const list = tree!.root.findByProps({ role: 'listbox' });
  const field = input();
  expect(field.props.role).toBe('combobox');
  expect(field.props['aria-expanded']).toBe(true);
  expect(field.props['aria-controls']).toBe(list.props.id);
  expect(options()).toHaveLength(4);
  expect(field.props['aria-activedescendant']).toBe(options()[0].props.id);
  act(() => input().props.onKeyDown({ key: 'ArrowDown', preventDefault() {} }));
  expect(input().props['aria-activedescendant']).toBe(options()[1].props.id);
  expect(new Set(options().map(option => option.props.id)).size).toBe(4);
});
