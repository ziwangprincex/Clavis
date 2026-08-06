import { describe, expect, it } from 'vitest';
import { typstWorkspaceSymbols } from './typstWorkspaceScan';

function workspace(activeText: string, extra: Array<{ path: string; text: string }> = []) {
  return {
    rootPath: '/paper', activePath: '/paper/main.typ',
    documents: [{ path: '/paper/main.typ', language: 'typst' as const, text: activeText }, ...extra.map(item => ({ ...item, language: 'typst' as const }))],
  };
}

describe('Typst static workspace imports', () => {
  it('discovers star and selected imports with aliases', () => {
    const symbols = typstWorkspaceSymbols(workspace(
      '#import "./lib/helpers.typ": *, original as renamed\n#import "lib/tables.typ" as tables\n#let local = 1',
      [
        { path: '/paper/lib/helpers.typ', text: '#let build-card(title) = []\n#let original(x) = []\n#let hidden = 1' },
        { path: '/paper/lib/tables.typ', text: '#let make-table(data) = []' },
      ],
    ));
    expect(symbols.get('build-card')).toMatchObject({ kind: 'function', imported: true });
    expect(symbols.get('renamed')).toMatchObject({ kind: 'function', imported: true });
    expect(symbols.get('tables')).toMatchObject({ kind: 'module', imported: true });
    expect(symbols.get('local')).toMatchObject({ kind: 'value', imported: false });
  });

  it('keeps local definitions ahead of imported names and follows nested imports', () => {
    const symbols = typstWorkspaceSymbols(workspace(
      '#import "lib/a.typ": *\n#let helper(local) = []',
      [
        { path: '/paper/lib/a.typ', text: '#import "b.typ": *\n#let helper(imported) = []' },
        { path: '/paper/lib/b.typ', text: '#let deep(value) = []' },
      ],
    ));
    expect(symbols.get('helper')?.params?.[0].name).toBe('local');
    expect(symbols.get('deep')).toMatchObject({ kind: 'function', imported: true });
  });

  it('ignores dynamic, package, escaping, and commented imports', () => {
    const symbols = typstWorkspaceSymbols(workspace(
      '// #import "lib/helpers.typ": *\n#import variable\n#import "../secret.typ": *\n#import "@preview/x": *',
      [{ path: '/paper/lib/helpers.typ', text: '#let leaked() = []' }],
    ));
    expect(symbols.size).toBe(0);
  });

  it('stays finite on import cycles', () => {
    const symbols = typstWorkspaceSymbols(workspace('#import "a.typ": *', [
      { path: '/paper/a.typ', text: '#import "b.typ": *\n#let a() = []' },
      { path: '/paper/b.typ', text: '#import "a.typ": *\n#let b() = []' },
    ]));
    expect([...symbols.keys()].sort()).toEqual(['a', 'b']);
  });
});
