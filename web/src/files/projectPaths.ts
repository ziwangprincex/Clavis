// Pure path-resolution helpers for multi-file LaTeX projects.
//
// These map between the various path representations that flow around a project:
// - workdir-relative paths from the SyncTeX CLI (e.g. "chapters/intro.tex")
// - project-relative paths stored on ProjectFile.relPath
// - absolute on-disk paths (ProjectFile.absPath, Tab.filePath)
// - raw \input{...} arguments (may omit the .tex extension, may be ./-prefixed)
//
// Kept free of stores/DOM so they can be unit-tested in isolation.

import type { ProjectFile } from '../store/project';

/**
 * Normalize an absolute path for cross-source comparison. Rust's
 * `std::fs::canonicalize` returns Windows extended-length "\\?\C:\..." verbatim
 * paths, while the Tauri dialog / tab.filePath give plain "C:\...". Strip the
 * `\\?\` (and `\\?\UNC\`) prefix, unify slashes, and lower-case a drive letter
 * so the two representations match. Non-Windows paths pass through unchanged
 * apart from slash unification.
 */
export function normalizePath(p: string | null | undefined): string {
  if (!p) return '';
  let s = p;
  if (s.startsWith('\\\\?\\UNC\\')) s = '\\\\' + s.slice(8);
  else if (s.startsWith('\\\\?\\')) s = s.slice(4);
  s = s.replace(/\\/g, '/');
  // Windows filesystems are case-insensitive, so fold case for a stable compare
  // — but ONLY for Windows-style paths (drive-letter "C:/…" or UNC "//host/…").
  // POSIX paths are case-sensitive and must be left as-is (this helper is shared
  // across platforms; the unit tests use POSIX paths).
  const isWindows = /^[A-Za-z]:\//.test(s) || s.startsWith('//');
  if (isWindows) s = s.toLowerCase();
  return s;
}

/** True if two absolute paths refer to the same file, tolerant of \\?\ / slashes. */
export function pathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizePath(a) === normalizePath(b);
}

/** Normalize a path for comparison: forward slashes, strip leading "./". */
function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Resolve a workdir-relative path returned by SyncTeX (e.g. "chapters/intro.tex"
 * or "main.tex") to an absolute on-disk path, by matching it against the
 * project's collected files.
 *
 * Returns null when there is no active project, the file is the root/main.tex,
 * or no match is found — callers then fall back to scrolling the active editor.
 */
export function resolveSyncTexFile(
  relPath: string | undefined,
  files: ProjectFile[],
  rootAbs: string | null,
): string | null {
  if (!relPath || !rootAbs) return null;
  const want = normalizeRel(relPath);
  // "main.tex" (or empty) means the root — the active tab already holds it.
  if (want === '' || want === 'main.tex') return null;
  const hit = files.find(f => normalizeRel(f.relPath) === want);
  return hit ? hit.absPath : null;
}

/**
 * Resolve a raw \input{...}/\include{...}/\import{dir}{file} argument to an
 * absolute path within the project. The argument may use forward slashes, omit
 * a .tex extension, and be "./"-prefixed.
 *
 * Resolution order depends on the macro:
 * - \input/\include/\subfile: LaTeX resolves these relative to the MAIN
 *   document's directory (compiler cwd), so we try the project-root-relative
 *   path first, then the including file's directory as a fallback.
 * - \import/\subimport: the `import` package resolves relative to the including
 *   file's directory first (that's its whole purpose), so we prefer that.
 *
 * `raw` for import-family macros should already be the joined "dir/file".
 * Returns the matched ProjectFile.absPath, or null if unresolved.
 */
export function resolveIncludeTarget(
  raw: string,
  currentFileAbs: string | null,
  files: ProjectFile[],
  isImport = false,
): string | null {
  if (!raw) return null;
  const target = normalizeRel(raw.trim());
  const candidates = target.endsWith('.tex') ? [target] : [`${target}.tex`, target];

  // Directory of the including file, relative to the project root.
  const currentRel = currentFileAbs
    ? files.find(f => pathsEqual(f.absPath, currentFileAbs))?.relPath
    : undefined;
  const currentDir = currentRel ? normalizeRel(currentRel).replace(/[^/]*$/, '') : '';

  const tryPaths: string[] = [];
  for (const c of candidates) {
    const rootRel = c;
    const dirRel = currentDir ? normalizeRel(currentDir + c) : null;
    if (isImport) {
      // import-family: including-file directory first.
      if (dirRel) tryPaths.push(dirRel);
      tryPaths.push(rootRel);
    } else {
      // input/include: main-document (root) directory first.
      tryPaths.push(rootRel);
      if (dirRel) tryPaths.push(dirRel);
    }
  }

  for (const p of tryPaths) {
    const hit = files.find(f => normalizeRel(f.relPath) === p);
    if (hit) return hit.absPath;
  }
  return null;
}
