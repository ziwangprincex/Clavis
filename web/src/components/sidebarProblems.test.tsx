import { useEffect } from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';
import { LogPanel } from './LogPanel';
import { useCompileStore } from '../store/compile';

vi.mock('../i18n', () => ({ t: (text: string) => text }));
let tree: ReactTestRenderer | undefined;
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
const tabs = () => tree!.root.findAllByProps({ role: 'tab' }).map(tab => tab.props['aria-label'] as string);
const panelHidden = (id: string) => tree!.root.findAllByProps({ role: 'tabpanel' }).find(panel => String(panel.props.id).endsWith(`-${id}`))!.props.hidden as boolean;
afterEach(() => { act(() => tree?.unmount()); tree = undefined; useCompileStore.getState().clearLog(); });

it('has no Problems tab unless a problems panel is supplied', () => {
  act(() => { tree = create(<Sidebar outline={<span>Outline</span>} />); });
  expect(tabs()).toEqual(['Document', 'Research']);
});

it('shows the compile log only when the Problems tab is selected', () => {
  useCompileStore.getState().setErrors([{ message: 'Undefined control sequence', file: 'chap/intro.tex', line: 12, kind: 'error' }]);
  act(() => { tree = create(<Sidebar outline={<span>Outline</span>} problems={<LogPanel onJumpTo={vi.fn()} />} problemCount={1} />); });
  expect(tabs()).toEqual(['Document', 'Research', 'Problems']);
  expect(panelHidden('problems')).toBe(true);
  expect(panelHidden('documents')).toBe(false);
  const problemsTab = tree!.root.findAllByProps({ role: 'tab' })[2];
  expect(problemsTab.findAllByProps({ 'aria-hidden': 'true' }).some(node => node.type === 'span')).toBe(true);
  act(() => problemsTab.props.onClick());
  expect(panelHidden('problems')).toBe(false);
  expect(panelHidden('documents')).toBe(true);
  expect(text(tree!.root)).toContain('chap/intro.tex:12');
  expect(problemsTab.findAllByType('span')).toHaveLength(0);
});

it('follows a controlled view and reports user switches', () => {
  const onViewChange = vi.fn();
  act(() => { tree = create(<Sidebar problems={<LogPanel />} view="problems" onViewChange={onViewChange} />); });
  expect(panelHidden('problems')).toBe(false);
  act(() => tree!.root.findAllByProps({ role: 'tab' })[0].props.onClick());
  expect(onViewChange).toHaveBeenCalledWith('documents');
  act(() => tree!.update(<Sidebar problems={<LogPanel />} view="documents" onViewChange={onViewChange} />));
  expect(panelHidden('problems')).toBe(true);
});

it('keeps document content mounted while selecting Problems and returning', () => {
  const mounted = vi.fn(), unmounted = vi.fn();
  function Document() { useEffect(() => { mounted(); return unmounted; }, []); return <span>Document tree</span>; }
  act(() => { tree = create(<Sidebar folderTree={<Document />} problems={<LogPanel />} />); });
  act(() => tree!.root.findByProps({ role: 'tab', 'aria-label': 'Problems' }).props.onClick());
  act(() => tree!.root.findByProps({ role: 'tab', 'aria-label': 'Document' }).props.onClick());
  expect(panelHidden('documents')).toBe(false);
  expect(mounted).toHaveBeenCalledOnce();
  expect(unmounted).not.toHaveBeenCalled();
});

it('does not render streaming logs in an unselected or hidden sidebar and retains their data', () => {
  const rendered = vi.fn();
  function StreamingLog() {
    const lines = useCompileStore(state => state.logLines);
    rendered();
    return <span>{lines.map(line => line.text).join('\n')}</span>;
  }
  act(() => { tree = create(<Sidebar problems={<StreamingLog />} view="documents" />); });
  act(() => useCompileStore.getState().appendLog({ run: 1, stream: 'stdout', text: 'retained output' }));
  expect(rendered).not.toHaveBeenCalled();
  act(() => tree!.update(<Sidebar problems={<StreamingLog />} view="problems" />));
  expect(rendered).toHaveBeenCalledOnce();
  expect(text(tree!.root)).toContain('retained output');
  act(() => tree!.update(<Sidebar problems={<StreamingLog />} view="problems" hidden />));
  rendered.mockClear();
  act(() => useCompileStore.getState().appendLog({ run: 1, stream: 'stderr', text: 'new output' }));
  expect(rendered).not.toHaveBeenCalled();
  act(() => tree!.update(<Sidebar problems={<StreamingLog />} view="problems" />));
  expect(text(tree!.root)).toContain('retained output\nnew output');
});
