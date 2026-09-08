import type { Tab } from '../store/tabs';
import type { ProjectFile } from '../store/project';
import { pathsEqual } from '../files/projectPaths';
import { documentRoot } from './project';
import { useProjectStore } from '../store/project';

export function latexRoot(tab: Tab, project: { rootAbs: string | null; files: ProjectFile[] }): string | null {
  return documentRoot(tab, { ...useProjectStore.getState(), ...project });
}

export function belongsToPdf(tab: Tab | undefined, pdf: {
  sourceRoot: string | null;
  sourceFiles: ProjectFile[];
  ownerTabId: string | null;
}): boolean {
  if (!tab || tab.lang !== 'latex') return false;
  if (!pdf.sourceRoot) return tab.id === pdf.ownerTabId;
  return !!tab.filePath && (pathsEqual(tab.filePath, pdf.sourceRoot)
    || pdf.sourceFiles.some(file => pathsEqual(file.absPath, tab.filePath)));
}
