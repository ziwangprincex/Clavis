import { fs, type WorkspaceInspection } from '../api/tauri';
import type { Tab } from '../store/tabs';
import { useProjectStore, useTabsStore, useSettingsStore } from '../store';
import { normalizePath, pathsEqual } from '../files/projectPaths';

export function inside(path: string | null | undefined, root: string | null | undefined): boolean {
  return !!path && !!root && normalizePath(path).startsWith(normalizePath(root).replace(/\/$/, '') + '/');
}
export function relativeTo(base: string, relative: string): string | null {
  if (!relative || /^(?:\/|[a-z]:|\\)/i.test(relative)) return null;
  const parts = base.replace(/\\/g, '/').replace(/\/$/, '').split('/');
  for (const part of relative.replace(/\\/g, '/').split('/')) {
    if (part === '..') { if (parts.length <= 1) return null; parts.pop(); }
    else if (part !== '.' && part) parts.push(part);
  }
  return parts.join('/');
}
export function magicComments(source: string): { root?: string; engine?: string } {
  const result: { root?: string; engine?: string } = {};
  for (const line of source.split(/\r?\n/).slice(0, 30)) {
    const match = /^\s*%\s*!\s*tex\s+(root|program|ts-program)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!match) continue;
    if (match[1].toLowerCase() === 'root') result.root = match[2];
    else result.engine = match[2].toLowerCase();
  }
  return result;
}
export function workspaceFor(tab: Tab, workspace: WorkspaceInspection | null): WorkspaceInspection | null {
  return workspace && inside(tab.filePath, workspace.root) ? workspace : null;
}
export function documentRoot(tab: Tab, project = useProjectStore.getState()): string | null {
  if (!tab.filePath) return null;
  if (tab.projectRoot) return tab.projectRoot;
  const workspace = workspaceFor(tab, project.workspace);
  const main = workspace?.config?.project.main;
  const extension = tab.lang === 'typst' ? /\.typ$/i : /\.tex$/i;
  if (main && extension.test(main)) {
    const path = relativeTo(workspace!.root, main);
    if (path && inside(path, workspace!.root)) return path;
  }
  if (tab.lang === 'latex') {
    const root = magicComments(tab.content).root;
    if (root) {
      const path = relativeTo(tab.filePath.replace(/[\\/][^\\/]*$/, ''), root);
      if (path) return path;
    }
  }
  if (project.rootAbs && extension.test(project.rootAbs) && (pathsEqual(tab.filePath, project.rootAbs)
    || project.files.some(file => pathsEqual(file.absPath, tab.filePath))
    || (tab.lang === 'typst' && inside(tab.filePath, project.rootAbs.replace(/[\\/][^\\/]*$/, ''))))) return project.rootAbs;
  return tab.filePath;
}
export function latexOptions(tab: Tab, mainSource: string) {
  const settings = useSettingsStore.getState().settings;
  const config = workspaceFor(tab, useProjectStore.getState().workspace)?.config?.latex;
  const owner = useTabsStore.getState().tabs.find(t => pathsEqual(t.filePath, documentRoot(tab)));
  const engine = owner?.latexEngineOverride ?? tab.latexEngineOverride ?? config?.engine ?? magicComments(mainSource).engine ?? magicComments(tab.content).engine ?? settings.latex_engine;
  if (!['pdflatex', 'xelatex', 'lualatex'].includes(engine)) throw new Error(`Unsupported LaTeX engine: ${engine}`);
  const bibliography = config?.bibliography ?? settings.bib_engine;
  if (!['auto', 'bibtex', 'biber', 'none'].includes(bibliography)) throw new Error(`Unsupported bibliography engine: ${bibliography}`);
  return { engine, customPath: settings.latex_custom_paths[engine], bibEngine: bibliography as 'auto' | 'bibtex' | 'biber' | 'none' };
}
export async function typstInput(tab: Tab, tabs = useTabsStore.getState().tabs, project = useProjectStore.getState()) {
  const docPath = documentRoot(tab, project);
  const workspace = workspaceFor(tab, project.workspace);
  const root = docPath ? (inside(docPath, workspace?.root) ? workspace!.root : docPath.replace(/[\\/][^\\/]*$/, '')) : null;
  const main = tabs.find(t => docPath && pathsEqual(t.filePath, docPath));
  const source = docPath ? main?.content ?? await fs.readTextFile(docPath) : tab.content;
  return { source, docPath, snapshot: { root, documents: tabs.filter(t => inside(t.filePath, root)).map(t => ({ path: t.filePath!, content: t.content })) } };
}
