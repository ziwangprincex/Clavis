import { describe, it, expect } from 'vitest';
import { resolveSyncTexFile, resolveIncludeTarget, normalizePath, pathsEqual } from './projectPaths';
import type { ProjectFile } from '../store/project';

function file(relPath: string, absPath: string): ProjectFile {
  return { relPath, absPath, content: '', isBib: relPath.endsWith('.bib') };
}

const FILES: ProjectFile[] = [
  file('main.tex', '/proj/main.tex'),
  file('chapters/intro.tex', '/proj/chapters/intro.tex'),
  file('chapters/sub/more.tex', '/proj/chapters/sub/more.tex'),
  file('refs.bib', '/proj/refs.bib'),
];

describe('resolveSyncTexFile', () => {
  it('maps a workdir-relative path to its absolute path', () => {
    expect(resolveSyncTexFile('chapters/intro.tex', FILES, '/proj/main.tex')).toBe(
      '/proj/chapters/intro.tex',
    );
  });

  it('strips a leading ./ and normalizes backslashes', () => {
    expect(resolveSyncTexFile('./chapters/intro.tex', FILES, '/proj/main.tex')).toBe(
      '/proj/chapters/intro.tex',
    );
    expect(resolveSyncTexFile('chapters\\intro.tex', FILES, '/proj/main.tex')).toBe(
      '/proj/chapters/intro.tex',
    );
  });

  it('returns null for main.tex / empty (root is already active)', () => {
    expect(resolveSyncTexFile('main.tex', FILES, '/proj/main.tex')).toBeNull();
    expect(resolveSyncTexFile('', FILES, '/proj/main.tex')).toBeNull();
  });

  it('returns null when no project is active', () => {
    expect(resolveSyncTexFile('chapters/intro.tex', FILES, null)).toBeNull();
  });

  it('returns null for an unknown file', () => {
    expect(resolveSyncTexFile('chapters/ghost.tex', FILES, '/proj/main.tex')).toBeNull();
  });
});

describe('resolveIncludeTarget', () => {
  it('resolves a root-relative include without extension', () => {
    expect(resolveIncludeTarget('chapters/intro', '/proj/main.tex', FILES)).toBe(
      '/proj/chapters/intro.tex',
    );
  });

  it('resolves a subfile-relative include via the current dir fallback', () => {
    // from chapters/intro.tex, \input{sub/more} → chapters/sub/more.tex
    // (root-relative "sub/more.tex" doesn't exist, so the current-dir fallback wins)
    expect(resolveIncludeTarget('sub/more', '/proj/chapters/intro.tex', FILES)).toBe(
      '/proj/chapters/sub/more.tex',
    );
  });

  it('prefers the root (main-doc) directory first for \\input/\\include', () => {
    // Duplicate basename in both root and subfile dir: \input resolves root-first.
    const files: ProjectFile[] = [
      file('main.tex', '/p/main.tex'),
      file('foo.tex', '/p/foo.tex'),
      file('chapters/intro.tex', '/p/chapters/intro.tex'),
      file('chapters/foo.tex', '/p/chapters/foo.tex'),
    ];
    // From chapters/intro.tex, \input{foo} → root /p/foo.tex (LaTeX cwd semantics).
    expect(resolveIncludeTarget('foo', '/p/chapters/intro.tex', files, false)).toBe('/p/foo.tex');
  });

  it('prefers the including-file directory for \\import (isImport=true)', () => {
    const files: ProjectFile[] = [
      file('main.tex', '/p/main.tex'),
      file('foo.tex', '/p/foo.tex'),
      file('chapters/intro.tex', '/p/chapters/intro.tex'),
      file('chapters/foo.tex', '/p/chapters/foo.tex'),
    ];
    // \import from chapters/intro.tex resolves relative to that dir first.
    expect(resolveIncludeTarget('foo', '/p/chapters/intro.tex', files, true)).toBe(
      '/p/chapters/foo.tex',
    );
  });

  it('accepts an explicit .tex extension and ./ prefix', () => {
    expect(resolveIncludeTarget('./chapters/intro.tex', '/proj/main.tex', FILES)).toBe(
      '/proj/chapters/intro.tex',
    );
  });

  it('returns null for an unresolved include', () => {
    expect(resolveIncludeTarget('nope/missing', '/proj/main.tex', FILES)).toBeNull();
  });
});

describe('normalizePath / pathsEqual', () => {
  it('strips the Windows \\\\?\\ verbatim prefix', () => {
    expect(normalizePath('\\\\?\\C:\\Users\\a\\main.tex')).toBe('c:/users/a/main.tex');
  });

  it('case-folds Windows paths (case-insensitive FS) but not the drive letter alone', () => {
    expect(normalizePath('C:\\Proj\\Main.tex')).toBe('c:/proj/main.tex');
  });

  it('leaves POSIX paths case-sensitive', () => {
    expect(normalizePath('/Proj/Main.tex')).toBe('/Proj/Main.tex');
  });

  it('treats case-differing Windows paths for the same file as equal', () => {
    expect(pathsEqual('C:\\Proj\\Main.tex', 'c:\\proj\\main.tex')).toBe(true);
  });

  it('treats \\\\?\\ and plain forms of the same file as equal', () => {
    expect(pathsEqual('\\\\?\\C:\\p\\main.tex', 'C:\\p\\main.tex')).toBe(true);
  });

  it('handles \\\\?\\UNC\\ share paths', () => {
    expect(normalizePath('\\\\?\\UNC\\server\\share\\f.tex')).toBe('//server/share/f.tex');
  });

  it('distinguishes genuinely different paths', () => {
    expect(pathsEqual('/p/a.tex', '/p/b.tex')).toBe(false);
  });
});
