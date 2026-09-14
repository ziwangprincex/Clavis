import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { LogPanel } from './LogPanel';
import { useCompileStore } from '../store/compile';
vi.mock('../i18n', () => ({ t: (text: string) => text }));
let tree: ReactTestRenderer | undefined;
beforeEach(() => { useCompileStore.getState().clearLog(); useCompileStore.getState().setStatus('idle'); });
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
  act(() => tree!.root.findAllByType('button').find(button => text(button) === 'Inspect source')!.props.onClick());
  expect(jump).toHaveBeenCalledWith('chap/intro.tex', 42);
  expect(build).not.toHaveBeenCalled();
});

const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
it('separates streamed raw output lines without duplicating existing newlines', () => {
  for (const value of ['first', 'second\n', 'third']) useCompileStore.getState().appendLog({ run: 1, stream: 'stdout', text: value });
  useCompileStore.getState().setLogTail('failure summary');
  act(() => { tree = create(<LogPanel />); });
  expect(text(tree!.root.findByType('pre'))).toBe('[1] first\n[1] second\n[1] third\n\n--- summary log tail ---\nfailure summary');
});
it.each([
  ['idle', 'No compile result yet.'],
  ['compiling', 'Compiling…'],
  ['error', 'Compile failed. Open raw output for details.'],
  ['ok', 'No errors.'],
] as const)('shows an honest empty state for %s', (status, message) => {
  useCompileStore.getState().setStatus(status);
  act(() => { tree = create(<LogPanel />); });
  expect(text(tree!.root)).toContain(message);
  if (status !== 'ok') {
    expect(text(tree!.root)).not.toContain('No errors.');
    expect(text(tree!.root)).not.toContain('{count} issues');
  }
});

it('makes source locations keyboard-accessible buttons without reordering paths', () => {
  const jump = vi.fn();
  useCompileStore.getState().setErrors([{ message: 'Unknown error', file: 'chap/intro.tex', line: 12, kind: 'error' }]);
  act(() => { tree = create(<LogPanel onJumpTo={jump} />); });
  const location = tree!.root.findByProps({ title: 'chap/intro.tex:12' });
  expect(location.type).toBe('button');
  expect(location.props.type).toBe('button');
  expect(location.findByType('bdi').props.dir).toBe('ltr');
  act(() => location.props.onClick());
  expect(jump).toHaveBeenCalledWith('chap/intro.tex', 12);
});
it.each([0, -1, 1.5])('does not offer source navigation for an invalid line %s', line => {
  useCompileStore.getState().setErrors([{ message: 'Unknown error', line, kind: 'error' }]);
  act(() => { tree = create(<LogPanel onJumpTo={vi.fn()} />); });
  expect(tree!.root.findAllByType('button')).toHaveLength(0);
});
