import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fs, type WorkspaceInspection } from '../api/tauri';
import { documentRoot, inside, latexOptions, magicComments, typstInput } from './project';
import { useProjectStore, useSettingsStore, useTabsStore, defaultSettings, type Tab } from '../store';
vi.mock('../api/tauri', () => ({ fs: { readTextFile: vi.fn() } }));
const main: Tab = { id: 'main', filePath: '/p/main.typ', title: 'Main', lang: 'typst', content: '#include "chapter.typ"', isDirty: true };
const child: Tab = { ...main, id: 'child', filePath: '/p/chapter.typ', content: 'unsaved chapter' };
const workspace: WorkspaceInspection = { root: '/p', trust: 'not-required', issues: [], hasExecutableTasks: false, config: { project: { main: 'main.typ' }, latex: { engine: 'xelatex', bibliography: 'biber' }, paths: { generated: [], ignored: [] }, tasks: {} } };
beforeEach(() => {
  useProjectStore.getState().reset();
  useProjectStore.setState({ workspace });
  useSettingsStore.setState({ settings: defaultSettings });
  useTabsStore.setState({ tabs: [main, child], activeTabId: child.id });
  vi.clearAllMocks();
});
describe('project compilation context', () => {
  it('previews and exports the main document with every unsaved project buffer', async () => {
    expect(documentRoot(child)).toBe('/p/main.typ');
    const input = await typstInput(child);
    expect(input.source).toBe(main.content);
    expect(input.snapshot.documents).toEqual([{ path: main.filePath, content: main.content }, { path: child.filePath, content: child.content }]);
    expect(fs.readTextFile).not.toHaveBeenCalled();
  });
  it('reads a closed main from disk but keeps dirty children in the snapshot', async () => {
    vi.mocked(fs.readTextFile).mockResolvedValue('disk main');
    const input = await typstInput(child, [child]);
    expect(input.source).toBe('disk main');
    expect(input.snapshot.documents[0].content).toBe(child.content);
  });
  it('does not inherit roots for scratch or unrelated documents', () => {
    expect(documentRoot({ ...child, filePath: null, projectRoot: '/p/main.typ' })).toBeNull();
    expect(documentRoot({ ...child, filePath: '/private/a.typ' })).toBe('/private/a.typ');
    expect(inside('/project-other/a.typ', '/project')).toBe(false);
    expect(inside('C:\\P\\a.typ', 'c:/p')).toBe(true);
  });
  it('resolves magic roots with parent directories and honors explicit overrides', () => {
    const tab = { ...child, lang: 'latex' as const, filePath: '/p/chapter/a.tex', content: '% !TeX root = ../main.tex\n% !TEX program = lualatex' };
    expect(documentRoot(tab)).toBe('/p/main.tex');
    expect(documentRoot({ ...tab, projectRoot: '/p/other.tex' })).toBe('/p/other.tex');
    expect(magicComments(tab.content).engine).toBe('lualatex');
  });
  it('uses explicit engine, project config, magic comment, then global settings', () => {
    const tab = { ...child, lang: 'latex' as const, filePath: '/p/a.tex' };
    expect(latexOptions(tab, '% !TEX program = lualatex')).toMatchObject({ engine: 'xelatex', bibEngine: 'biber' });
    expect(latexOptions({ ...tab, latexEngineOverride: 'pdflatex' }, '')).toMatchObject({ engine: 'pdflatex' });
    useProjectStore.setState({ workspace: null });
    expect(latexOptions(tab, '% !TEX program = lualatex').engine).toBe('lualatex');
    expect(latexOptions(tab, '').engine).toBe(defaultSettings.latex_engine);
    expect(() => latexOptions(tab, '% !TEX program = evil')).toThrow('Unsupported');
  });
});
