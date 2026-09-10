import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView, HoverTooltipSource, Tooltip } from '@codemirror/view';
import type { CompletionWorkspace } from '../completions/types';
import { ipc, type BibEntry } from '../api/tauri';
import { writingAssist } from './writingAssist';

const capture = vi.hoisted(() => ({ source: null as HoverTooltipSource | null }));
vi.mock('@codemirror/view', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/view')>();
  return { ...actual, hoverTooltip: (source: HoverTooltipSource) => { capture.source = source; return []; } };
});
vi.mock('../api/tauri', () => ({ hasTauri: () => true, ipc: { parseBib: vi.fn() } }));
vi.mock('../i18n', () => ({ t: (text: string) => text }));

class Element {
  children: Element[] = [];
  textContent = '';
  style = {};
  append(...children: Element[]) { this.children.push(...children); }
  get text(): string { return [this.textContent, ...this.children.map(child => child.text)].join('\n'); }
}
const entry: BibEntry = { key: 'key', entryType: 'book', title: 'Report',
  author: 'World Health Organization', year: '2024', keywords: [],
  sourceFile: '/p/refs.bib', sourceLine: 3, sourceEndLine: 8 };
let workspace: CompletionWorkspace;
let view: { state: EditorState };
function setup(text: string) {
  view = { state: EditorState.create({ doc: text }) };
  writingAssist('latex', () => workspace);
}
async function hoverText() {
  const tooltip = await capture.source!(view as EditorView, 2, 1) as Tooltip | null;
  return tooltip ? (tooltip.create(view as EditorView).dom as unknown as Element).text : null;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('window', { document: { createElement: () => new Element() } });
  workspace = { rootPath: '/p/main.tex', activePath: '/p/main.tex', documents: [
    { path: '/p/main.tex', text: '\\label{sec:cite-method}', language: 'latex' },
    { path: '/p/refs.bib', text: '@book(key, title={Unsaved})', language: 'latex' },
  ] };
  vi.mocked(ipc.parseBib).mockResolvedValue([entry]);
});
afterEach(() => vi.unstubAllGlobals());

it.each(['ref', 'pageref', 'autoref', 'cref'])('does not misclassify \\%s when its label contains cite', async command => {
  setup(`\\${command}{sec:cite-method}`);
  expect(await hoverText()).toContain('\\label{sec:cite-method}');
  expect(ipc.parseBib).not.toHaveBeenCalled();
});
it.each(['cite', 'textcite', 'parencite*'])('uses the shared parser for \\%s and keeps full organizations', async command => {
  setup(`\\${command}[see][p. 2]{key}`);
  const text = await hoverText();
  expect(text).toContain('Report');
  expect(text).toContain('World Health Organization · 2024');
  expect(text).toContain('key · refs.bib:3');
  expect(ipc.parseBib).toHaveBeenCalledWith([], [{ path: '/p/refs.bib', content: '@book(key, title={Unsaved})' }]);
});
it('falls back to editor and displays only the year from a date', async () => {
  vi.mocked(ipc.parseBib).mockResolvedValue([{ ...entry, author: undefined, editor: '朱晓明', year: '2020-05-01' }]);
  setup('\\cite{key}');
  expect(await hoverText()).toContain('朱晓明 · 2020');
});
it('reports only a miss in loaded files, not that the entry cannot exist', async () => {
  vi.mocked(ipc.parseBib).mockResolvedValue([]);
  setup('\\cite{missing}');
  expect(await hoverText()).toContain('No matching entry was found in the loaded .bib files');
});
it('does not report a parser failure as a missing key', async () => {
  vi.mocked(ipc.parseBib).mockRejectedValue(new Error('worker failed'));
  setup('\\cite{key}');
  expect(await hoverText()).toContain('Could not read bibliography entries');
});
it.each(['document', 'root', 'active', 'bibliography'])('discards a pending result after %s changes', async kind => {
  let finish!: (entries: BibEntry[]) => void;
  vi.mocked(ipc.parseBib).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  setup('\\cite{key}');
  const pending = hoverText();
  if (kind === 'document') view.state = EditorState.create({ doc: 'new document' });
  if (kind === 'root') workspace = { ...workspace, rootPath: '/other/main.tex' };
  if (kind === 'active') workspace = { ...workspace, activePath: '/p/chapter.tex' };
  if (kind === 'bibliography') workspace = { ...workspace, documents: workspace.documents.slice(0, 1) };
  finish([entry]);
  expect(await pending).toBeNull();
});
it('discards errors that belong to an old document', async () => {
  let fail!: (error: Error) => void;
  vi.mocked(ipc.parseBib).mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  setup('\\cite{key}');
  const pending = hoverText();
  view.state = EditorState.create({ doc: 'new document' });
  fail(new Error('worker failed'));
  expect(await pending).toBeNull();
});
it('normalizes Windows paths and excludes other projects', async () => {
  workspace = { rootPath: 'C:\\Paper\\main.tex', activePath: 'C:\\Paper\\main.tex', documents: [
    { path: '\\\\?\\C:\\Paper\\refs.BIB', text: 'local', language: 'latex' },
    { path: 'C:/Paper-other/refs.bib', text: 'other', language: 'latex' },
  ] };
  setup('\\cite{key}');
  await hoverText();
  expect(ipc.parseBib).toHaveBeenCalledWith([], [{ path: '\\\\?\\C:\\Paper\\refs.BIB', content: 'local' }]);
});
