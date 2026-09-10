import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LogPanel } from './LogPanel';
import { useCompileStore } from '../store/compile';
vi.mock('../i18n', () => ({ t: (text: string) => text }));
let tree: ReactTestRenderer | undefined;
beforeEach(() => useCompileStore.getState().clearLog());
afterEach(() => { act(() => tree?.unmount()); tree = undefined; });
it.each(['Unknown error', 'Missing bibliography database: refs.bib', "Label `intro' multiply defined"])(
  'shows no source button without a location: %s', message => {
    useCompileStore.getState().setErrors([{ message, line: null, kind: 'error' }]);
    act(() => { tree = create(<LogPanel onJumpTo={vi.fn()} />); });
    expect(tree!.root.findAllByType('button')).toHaveLength(0);
  },
);
it('opens environment setup rather than rerunning a missing tool', () => {
  const environment = vi.fn();
  useCompileStore.getState().setErrors([{ message: 'biber not found in PATH', line: null, kind: 'error' }]);
  act(() => { tree = create(<LogPanel onEnvironment={environment} />); });
  const button = tree!.root.findByType('button');
  expect(button.children).toEqual(['Check environment']);
  act(() => button.props.onClick());
  expect(environment).toHaveBeenCalledOnce();
});
it('jumps to a duplicate label with a real location without invoking a build', () => {
  const jump = vi.fn(), build = vi.fn();
  useCompileStore.getState().setErrors([{ message: "Label `intro' multiply defined", file: 'chap/intro.tex', line: 42, kind: 'warning' }]);
  act(() => { tree = create(<LogPanel onJumpTo={jump} onFullBuild={build} />); });
  act(() => tree!.root.findByType('button').props.onClick());
  expect(jump).toHaveBeenCalledWith('chap/intro.tex', 42);
  expect(build).not.toHaveBeenCalled();
});
