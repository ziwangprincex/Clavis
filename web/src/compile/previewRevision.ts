import type { Tab } from '../store/tabs';
import { inside } from './project';
import { pathsEqual } from '../files/projectPaths';

export function previewDocuments(
  tabs: Tab[],
  main: string | null,
  root: string | null,
  dependencies?: string[],
): Tab[] {
  return tabs.filter(
    (t) =>
      (!!main && pathsEqual(t.filePath, main)) ||
      (inside(t.filePath, root) &&
        (!dependencies || dependencies.some((path) => pathsEqual(path, t.filePath)))),
  );
}
/** Comparing strings does not allocate/copy the full document, unlike JSON.stringify. */
export function revisionCounter() {
  let previous: unknown[] = [];
  let version = 0;
  return (parts: unknown[]) => {
    if (parts.length !== previous.length || parts.some((part, i) => part !== previous[i])) {
      previous = parts;
      version++;
    }
    return String(version);
  };
}
