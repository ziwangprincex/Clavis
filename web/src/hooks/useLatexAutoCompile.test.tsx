import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLatexAutoCompile } from './useLatexAutoCompile';
import { runLatexCompile } from '../compile/latex';
import type { Tab } from '../store/tabs';

vi.mock('../api/tauri', () => ({ hasTauri: () => true }));
vi.mock('../compile/latex', () => ({ runLatexCompile: vi.fn(async () => null) }));
const hello: Tab = {
  id: 'hello', title: 'hello.tex', lang: 'latex', filePath: null, isDirty: false,
  content: '\\documentclass{article}\n\n\\begin{document}\n  hello\n\\end{document}',
};
function Harness({ tab, enabled = true }: { tab?: Tab; enabled?: boolean }) {
  useLatexAutoCompile(tab, enabled);
  return null;
}
let tree: ReactTestRenderer;
const advance = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(300); }); };
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { act(() => tree?.unmount()); vi.useRealTimers(); });

it('compiles the first restored LaTeX document without requiring another edit', async () => {
  act(() => { tree = create(<Harness tab={hello} />); });
  await advance();
  expect(runLatexCompile).toHaveBeenCalledTimes(1);
});
it('compiles the first LaTeX tab after the initial empty or Markdown session', async () => {
  act(() => { tree = create(<Harness />); });
  await advance();
  expect(runLatexCompile).not.toHaveBeenCalled();
  act(() => tree.update(<Harness tab={{ ...hello, lang: 'markdown' }} />));
  await advance();
  expect(runLatexCompile).not.toHaveBeenCalled();
  act(() => tree.update(<Harness tab={hello} />));
  await advance();
  expect(runLatexCompile).toHaveBeenCalledTimes(1);
});
it('pauses hidden or disabled previews and compiles on reveal', async () => {
  act(() => { tree = create(<Harness tab={hello} enabled={false} />); });
  await advance();
  expect(runLatexCompile).not.toHaveBeenCalled();
  act(() => tree.update(<Harness tab={hello} />));
  await advance();
  expect(runLatexCompile).toHaveBeenCalledTimes(1);
});
it('debounces edits but does not compile for metadata-only updates', async () => {
  act(() => { tree = create(<Harness tab={hello} />); });
  act(() => tree.update(<Harness tab={{ ...hello, content: hello.content + '\n' }} />));
  await advance();
  expect(runLatexCompile).toHaveBeenCalledTimes(1);
  act(() => tree.update(<Harness tab={{ ...hello, title: 'Renamed', content: hello.content + '\n' }} />));
  await advance();
  expect(runLatexCompile).toHaveBeenCalledTimes(1);
});
it('cancels a pending compile on hide', async () => {
  act(() => { tree = create(<Harness tab={hello} />); });
  act(() => tree.update(<Harness tab={hello} enabled={false} />));
  await advance();
  expect(runLatexCompile).not.toHaveBeenCalled();
});


it.each([
  { filePath: '/new/main.tex' },
  { projectRoot: '/new/main.tex' },
  { latexEngineOverride: 'xelatex' },
])('recompiles when the compile input changes without editing text: %o', async (patch) => {
  act(() => { tree = create(<Harness tab={hello} />); });
  await advance();
  act(() => tree.update(<Harness tab={{ ...hello, ...patch }} />));
  await advance();
  expect(runLatexCompile).toHaveBeenCalledTimes(2);
});
it('compiles the latest path once when Save As happens during a pending debounce', async () => {
  act(() => { tree = create(<Harness tab={hello} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  act(() => tree.update(<Harness tab={{ ...hello, filePath: '/copy/main.tex' }} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(runLatexCompile).not.toHaveBeenCalled();
  await advance();
  expect(runLatexCompile).toHaveBeenCalledTimes(1);
});
