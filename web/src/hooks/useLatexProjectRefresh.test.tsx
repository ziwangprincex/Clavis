import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLatexAutoCompile } from './useLatexAutoCompile';
import { runLatexCompile } from '../compile/latex';
import { useProjectStore, useSettingsStore } from '../store';
import type { Tab } from '../store/tabs';
vi.mock('../api/tauri', () => ({ hasTauri: () => true, ipc: {} }));
vi.mock('../compile/latex', () => ({ runLatexCompile: vi.fn() }));
const tab: Tab = { id: 'a', title: 'main.tex', filePath: '/paper/main.tex', lang: 'latex', content: 'source', isDirty: false };
let tree: ReactTestRenderer;
function Harness({ enabled = true }: { enabled?: boolean }) { useLatexAutoCompile(tab, enabled); return null; }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  useProjectStore.getState().reset();
  useSettingsStore.setState({ loaded: false });
  act(() => { tree = create(<Harness />); });
});
afterEach(() => { act(() => tree.unmount()); vi.useRealTimers(); });
it('recompiles after a newly opened template folder supplies its engine settings', () => {
  act(() => { vi.advanceTimersByTime(300); });
  expect(runLatexCompile).toHaveBeenCalledTimes(1);
  act(() => useProjectStore.getState().setProject({ workspace: {
    root: '/paper', trust: 'not-required', issues: [], hasExecutableTasks: false,
    config: { project: { main: 'main.tex' }, latex: { engine: 'pdflatex' }, paths: { generated: [], ignored: [] }, tasks: {} },
  } }));
  act(() => { vi.advanceTimersByTime(300); });
  expect(runLatexCompile).toHaveBeenCalledTimes(2);
});
it('refreshes once persisted settings arrive but respects disabled auto compile', () => {
  act(() => { vi.advanceTimersByTime(300); });
  act(() => useSettingsStore.setState({ loaded: true }));
  act(() => { vi.advanceTimersByTime(300); });
  expect(runLatexCompile).toHaveBeenCalledTimes(2);
  act(() => tree.update(<Harness enabled={false} />));
  act(() => useSettingsStore.setState({ loaded: false }));
  act(() => { vi.advanceTimersByTime(300); });
  expect(runLatexCompile).toHaveBeenCalledTimes(2);
});
