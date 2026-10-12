// Languages highlighted inside Markdown code fences, matched on the fence's
// info string (```python). All come from the legacy modes package and load on
// first use, so documents without code pay nothing.

import { LanguageDescription, LanguageSupport, StreamLanguage, type StreamParser } from '@codemirror/language';

type Loader = () => Promise<StreamParser<unknown>>;

function mode(name: string, alias: string[], load: Loader) {
  return LanguageDescription.of({ name, alias, load: async () => new LanguageSupport(StreamLanguage.define(await load())) });
}

export const codeLanguages: LanguageDescription[] = [
  mode('Python', ['py', 'python3'], async () => (await import('@codemirror/legacy-modes/mode/python')).python),
  mode('Shell', ['sh', 'bash', 'zsh', 'console', 'shell-session'], async () => (await import('@codemirror/legacy-modes/mode/shell')).shell),
  mode('JavaScript', ['js', 'jsx', 'mjs', 'cjs', 'node'], async () => (await import('@codemirror/legacy-modes/mode/javascript')).javascript),
  mode('TypeScript', ['ts', 'tsx'], async () => (await import('@codemirror/legacy-modes/mode/javascript')).typescript),
  mode('JSON', ['json5', 'jsonc'], async () => (await import('@codemirror/legacy-modes/mode/javascript')).json),
  mode('HTML', ['htm', 'xhtml', 'vue', 'svelte'], async () => (await import('@codemirror/legacy-modes/mode/xml')).html),
  mode('XML', ['svg', 'plist'], async () => (await import('@codemirror/legacy-modes/mode/xml')).xml),
  mode('CSS', [], async () => (await import('@codemirror/legacy-modes/mode/css')).css),
  mode('SCSS', ['sass'], async () => (await import('@codemirror/legacy-modes/mode/css')).sCSS),
  mode('C', ['h'], async () => (await import('@codemirror/legacy-modes/mode/clike')).c),
  mode('C++', ['cpp', 'cc', 'cxx', 'hpp', 'cuda'], async () => (await import('@codemirror/legacy-modes/mode/clike')).cpp),
  mode('C#', ['cs', 'csharp'], async () => (await import('@codemirror/legacy-modes/mode/clike')).csharp),
  mode('Java', [], async () => (await import('@codemirror/legacy-modes/mode/clike')).java),
  mode('Kotlin', ['kt'], async () => (await import('@codemirror/legacy-modes/mode/clike')).kotlin),
  mode('Scala', [], async () => (await import('@codemirror/legacy-modes/mode/clike')).scala),
  mode('Objective-C', ['objc', 'objective-c'], async () => (await import('@codemirror/legacy-modes/mode/clike')).objectiveC),
  mode('Dart', [], async () => (await import('@codemirror/legacy-modes/mode/clike')).dart),
  mode('Swift', [], async () => (await import('@codemirror/legacy-modes/mode/swift')).swift),
  mode('Rust', ['rs'], async () => (await import('@codemirror/legacy-modes/mode/rust')).rust),
  mode('Go', ['golang'], async () => (await import('@codemirror/legacy-modes/mode/go')).go),
  mode('Ruby', ['rb'], async () => (await import('@codemirror/legacy-modes/mode/ruby')).ruby),
  mode('Lua', [], async () => (await import('@codemirror/legacy-modes/mode/lua')).lua),
  mode('Perl', ['pl'], async () => (await import('@codemirror/legacy-modes/mode/perl')).perl),
  mode('R', ['rscript'], async () => (await import('@codemirror/legacy-modes/mode/r')).r),
  mode('Julia', ['jl'], async () => (await import('@codemirror/legacy-modes/mode/julia')).julia),
  mode('Haskell', ['hs'], async () => (await import('@codemirror/legacy-modes/mode/haskell')).haskell),
  mode('MATLAB', ['matlab', 'octave', 'm'], async () => (await import('@codemirror/legacy-modes/mode/octave')).octave),
  mode('Fortran', ['f90', 'f95'], async () => (await import('@codemirror/legacy-modes/mode/fortran')).fortran),
  mode('SQL', ['sqlite', 'postgresql', 'psql', 'mysql'], async () => (await import('@codemirror/legacy-modes/mode/sql')).standardSQL),
  mode('YAML', ['yml'], async () => (await import('@codemirror/legacy-modes/mode/yaml')).yaml),
  mode('TOML', [], async () => (await import('@codemirror/legacy-modes/mode/toml')).toml),
  mode('LaTeX', ['tex', 'latex', 'bibtex'], async () => (await import('@codemirror/legacy-modes/mode/stex')).stex),
  mode('Diff', ['patch'], async () => (await import('@codemirror/legacy-modes/mode/diff')).diff),
  mode('Dockerfile', ['docker'], async () => (await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile),
  mode('PowerShell', ['ps1', 'pwsh'], async () => (await import('@codemirror/legacy-modes/mode/powershell')).powerShell),
];
