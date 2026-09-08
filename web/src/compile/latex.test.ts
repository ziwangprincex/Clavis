import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipc, events, type CompileResult } from '../api/tauri';
import { useTabsStore, useSettingsStore, defaultSettings, useProjectStore, useCompileStore, usePdfStore } from '../store';
import { runLatexCompile } from './latex';
import { belongsToPdf, latexRoot } from './target';

vi.mock('../api/tauri', () => ({
  ipc: { collectLatexSnapshot: vi.fn(), compileLatex: vi.fn(), cleanupWorkdir: vi.fn().mockResolvedValue(undefined) },
  events: { onLatexLog: vi.fn(), onLatexRunStart: vi.fn() },
}));
const result: CompileResult = { ok: true, errors: [], pdfBase64: 'JVBERi0=', logTail: '', runs: 1, workdirToken: 'new-token' };
const files = [
  { absPath: '/p/paper.tex', relPath: 'paper.tex', content: 'main buffer', isBib: false },
  { absPath: '/p/chapter.tex', relPath: 'chapter.tex', content: 'chapter buffer', isBib: false },
  { absPath: '/p/figure.png', relPath: 'figure.png', content: '', binaryBase64: 'aW1hZ2U=', isBib: false },
];
const dispose = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(events.onLatexLog).mockResolvedValue(dispose);
  vi.mocked(events.onLatexRunStart).mockResolvedValue(dispose);
  vi.mocked(ipc.compileLatex).mockResolvedValue(result);
  vi.mocked(ipc.collectLatexSnapshot).mockResolvedValue({ rootRel: 'paper.tex', files, warnings: [] });
  useTabsStore.setState({ activeTabId: 'chapter', tabs: [
    { id: 'main', title: 'paper.tex', filePath: '/p/paper.tex', lang: 'latex', content: 'main buffer', isDirty: true },
    { id: 'chapter', title: 'chapter.tex', filePath: '/p/chapter.tex', lang: 'latex', content: 'chapter buffer', isDirty: true },
  ] });
  useProjectStore.setState({ rootAbs: '/p/paper.tex', files });
  useSettingsStore.setState({ settings: defaultSettings });
  usePdfStore.setState({ bytes: null, workdirToken: null, sourceRoot: null, sourceFiles: [], ownerTabId: null });
  useCompileStore.setState({ status: 'idle', errors: [] });
});

describe('LaTeX compile snapshot', () => {
  it('compiles the main document from an active chapter, carrying every open buffer and binary resource', async () => {
    await runLatexCompile();
    expect(ipc.collectLatexSnapshot).toHaveBeenCalledWith('/p/paper.tex', [
      { path: '/p/paper.tex', content: 'main buffer' }, { path: '/p/chapter.tex', content: 'chapter buffer' },
    ]);
    expect(ipc.compileLatex).toHaveBeenCalledWith(expect.objectContaining({ source: 'main buffer', projectFiles: [
      { relPath: 'chapter.tex', content: 'chapter buffer', binaryBase64: null },
      { relPath: 'figure.png', content: '', binaryBase64: 'aW1hZ2U=' },
    ] }));
    expect(useTabsStore.getState().tabs[0].latexWorkdirToken).toBe('new-token');
    expect(useTabsStore.getState().tabs[1].latexWorkdirToken).toBeUndefined();
    expect(usePdfStore.getState().sourceRoot).toBe('/p/paper.tex');
    expect(useTabsStore.getState().tabs.every(tab => tab.isDirty)).toBe(true);
  });
  it('uses a fresh snapshot directory and releases the previous one', async () => {
    useTabsStore.getState().patchTab('main', { projectRoot: '/p/paper.tex', latexWorkdirToken: 'old-token' });
    await runLatexCompile();
    expect(ipc.compileLatex).toHaveBeenCalledWith(expect.objectContaining({ workdirToken: null }));
    expect(ipc.cleanupWorkdir).toHaveBeenCalledWith('old-token');
  });
  it('does not compile an unrelated document with a previous project main', () => {
    const tab = { ...useTabsStore.getState().tabs[0], filePath: '/other/file.tex' };
    expect(latexRoot(tab, useProjectStore.getState())).toBe('/other/file.tex');
    expect(belongsToPdf(tab, { sourceRoot: '/p/paper.tex', sourceFiles: files, ownerTabId: 'main' })).toBe(false);
  });
  it('matches normalized Windows paths', () => {
    const tab = { ...useTabsStore.getState().tabs[0], filePath: 'C:\\P\\main.tex' };
    expect(latexRoot(tab, { rootAbs: '\\\\?\\C:\\p\\main.tex', files: [] })).toBe('\\\\?\\C:\\p\\main.tex');
  });
  it('does not leak project files into a scratch document', async () => {
    useTabsStore.getState().patchTab('chapter', { filePath: null });
    await runLatexCompile();
    expect(ipc.collectLatexSnapshot).not.toHaveBeenCalled();
    expect(ipc.compileLatex).toHaveBeenCalledWith(expect.objectContaining({ source: 'chapter buffer', projectFiles: [] }));
  });
  it('clears a previous PDF on failure even when the backend supplies old bytes', async () => {
    usePdfStore.setState({ bytes: new Uint8Array([1]), workdirToken: 'old' });
    vi.mocked(ipc.compileLatex).mockResolvedValue({ ...result, ok: false });
    await runLatexCompile();
    expect(usePdfStore.getState().bytes).toBeNull();
    expect(usePdfStore.getState().workdirToken).toBeNull();
    expect(useCompileStore.getState().status).toBe('error');
  });
  it('cleans partial event setup and can compile again after a listener rejects', async () => {
    vi.mocked(events.onLatexRunStart).mockRejectedValueOnce(new Error('listener unavailable'));
    expect(await runLatexCompile()).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(useCompileStore.getState().status).toBe('error');
    await runLatexCompile();
    expect(ipc.compileLatex).toHaveBeenCalledTimes(1);
    expect(useCompileStore.getState().status).toBe('ok');
  });
  it('reports collection failures instead of falling back to a stale snapshot', async () => {
    vi.mocked(ipc.collectLatexSnapshot).mockRejectedValueOnce(new Error('main removed'));
    await runLatexCompile();
    expect(ipc.compileLatex).not.toHaveBeenCalled();
    expect(useCompileStore.getState().errors[0].message).toContain('main removed');
  });
  it('does not display output after switching to an unrelated tab mid-compile', async () => {
    vi.mocked(ipc.compileLatex).mockImplementationOnce(async () => {
      useTabsStore.getState().patchTab('chapter', { filePath: '/other/doc.tex' });
      return result;
    });
    await runLatexCompile();
    expect(usePdfStore.getState().bytes).toBeNull();
  });
  it('coalesces requests and collects the newest buffer on the rerun', async () => {
    let release!: (r: CompileResult) => void;
    vi.mocked(ipc.compileLatex).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = runLatexCompile();
    await vi.waitFor(() => expect(ipc.compileLatex).toHaveBeenCalledTimes(1));
    useTabsStore.getState().patchTab('chapter', { content: 'newest buffer' });
    await runLatexCompile();
    await runLatexCompile();
    release(result);
    await first;
    await vi.waitFor(() => expect(useCompileStore.getState().status).toBe('ok'));
    expect(ipc.compileLatex).toHaveBeenCalledTimes(2);
    expect(ipc.collectLatexSnapshot).toHaveBeenLastCalledWith('/p/paper.tex', expect.arrayContaining([{ path: '/p/chapter.tex', content: 'newest buffer' }]));
  });
});
