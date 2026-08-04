/**
 * Corpus check: run the parser across every bundled `.cwl` file.
 *
 * The synthetic tests in `cwlParser.test.ts` verify shapes taken from the
 * TeXstudio manual. This file verifies the parser against the 4465 real files,
 * which contain constructs the manual never documents. It is the difference
 * between "handles the spec" and "handles the data".
 *
 * Skipped when `resources/cwl/` is absent, so a clean checkout without
 * `node tools/fetch-cwl.mjs` still runs green.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCwl } from './cwlParser';

const CWL_DIR = path.resolve(__dirname, '../../../resources/cwl');
const available = existsSync(CWL_DIR);
const files = available ? readdirSync(CWL_DIR).filter(f => f.endsWith('.cwl')) : [];

const suite = available ? describe : describe.skip;

suite('cwl corpus', () => {
  const parsed = files.map(f => ({
    file: f,
    pkg: parseCwl(readFileSync(path.join(CWL_DIR, f), 'utf8'), f.replace(/\.cwl$/, '')),
  }));

  it('parses every file without throwing', () => {
    expect(parsed.length).toBeGreaterThan(4000);
  });

  it('extracts a large command set', () => {
    const total = parsed.reduce((n, p) => n + p.pkg.commands.length, 0);
    // Sanity floor: the corpus yields tens of thousands of commands. A crash in
    // one popular file would show up as a big drop here.
    expect(total).toBeGreaterThan(50_000);
  });

  it('leaves no unconverted placeholder markers in any snippet', () => {
    const bad: string[] = [];
    for (const { file, pkg } of parsed) {
      for (const c of [...pkg.commands, ...pkg.environments]) {
        // `%<`, `%|`, `%\` surviving into a snippet means the converter missed
        // a form and the user would see raw cwl syntax inserted.
        if (/%[<|]/.test(c.snippet)) bad.push(`${file}: ${c.snippet.slice(0, 70)}`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('emits balanced CM6 field syntax', () => {
    const bad: string[] = [];
    for (const { file, pkg } of parsed) {
      for (const c of [...pkg.commands, ...pkg.environments]) {
        const opens = (c.snippet.match(/\$\{/g) ?? []).length;
        if (opens === 0) continue;
        // Every `${` needs a matching unescaped `}`; otherwise CodeMirror's
        // snippet parser mis-reads the template on insertion.
        const closes = (c.snippet.match(/(?<!\\)\}/g) ?? []).length;
        if (closes < opens) bad.push(`${file}: ${c.snippet.slice(0, 70)}`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('never emits a shell-escape construct', () => {
    const bad: string[] = [];
    for (const { file, pkg } of parsed) {
      for (const c of [...pkg.commands, ...pkg.environments]) {
        if (/\\(write|immediate|openout|catcode)(?![a-zA-Z])/i.test(c.snippet)) {
          bad.push(`${file}: ${c.snippet.slice(0, 70)}`);
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('drops almost nothing', () => {
    const dropped = parsed.reduce((n, p) => n + p.pkg.droppedLines, 0);
    const kept = parsed.reduce((n, p) => n + p.pkg.commands.length + p.pkg.environments.length, 0);
    // Measured at 35 dropped lines out of ~245k entries (0.014%) — every one a
    // malformed upstream line such as `\newterm{term{`. A regression in the
    // parser would blow past this ceiling immediately.
    expect(dropped / (dropped + kept)).toBeLessThan(0.001);
  });

  it('parses the packages that matter for everyday writing', () => {
    const byName = new Map(parsed.map(p => [p.pkg.name, p.pkg]));
    for (const name of ['latex-document', 'amsmath', 'graphicx', 'hyperref', 'siunitx']) {
      const pkg = byName.get(name);
      expect(pkg, `${name} missing`).toBeDefined();
      expect(pkg!.commands.length, `${name} yielded no commands`).toBeGreaterThan(10);
    }
  });

  it('resolves \\frac and \\sqrt as math-only with placeholders', () => {
    const byName = new Map(parsed.map(p => [p.pkg.name, p.pkg]));
    const doc = byName.get('latex-document')!;
    const frac = doc.commands.find(c => c.name === 'frac');
    expect(frac?.snippet).toBe('\\frac{${1:num}}{${2:den}}');
    expect(frac?.mathOnly).toBe(true);
  });

  it('reads amsmath dependencies and environments', () => {
    const ams = parsed.find(p => p.pkg.name === 'amsmath')!.pkg;
    expect(ams.deps).toContain('amstext');
    const align = ams.environments.find(e => e.name === 'align');
    expect(align).toBeDefined();
    expect(align!.snippet).toContain('\\end{align}');
  });
});
