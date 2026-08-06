import { describe, expect, it } from 'vitest';
import { latexEnvironmentDeclarationLine, latexMacroDeclarationLine, latexWorkspaceEnvironments, latexWorkspaceMacros, scanLatexEnvironmentDeclarations, scanLatexMacros } from './latexMacroScan';

describe('LaTeX macro declaration scanner', () => {
  it('reads classic and xparse command declarations', () => {
    const macros = scanLatexMacros('\\newcommand{\\term}[2][default]{#2}\n\\NewDocumentCommand\\card{m O{wide} +m}{}');
    expect(macros).toContainEqual(expect.objectContaining({ name: 'term', required: 1, optional: true }));
    expect(macros).toContainEqual(expect.objectContaining({ name: 'card', required: 2, optional: true, slots: [false, true, false] }));
  });

  it('ignores comments and verbatim declarations', () => {
    const macros = scanLatexMacros('% \\newcommand{\\ghost}{}\n\\begin{verbatim}\n\\newcommand{\\raw}{}\n\\end{verbatim}\n\\providecommand\\real[1]{}');
    expect(macros.map(item => item.name)).toEqual(['real']);
  });

  it('keeps active document macros ahead of workspace declarations', () => {
    const macros = latexWorkspaceMacros({ rootPath: '/paper', activePath: '/paper/main.tex', documents: [
      { path: '/paper/main.tex', language: 'latex', text: '\\newcommand{\\same}[1]{}' },
      { path: '/paper/style.tex', language: 'latex', text: '\\newcommand{\\same}[2]{}\\newcommand{\\other}{}' },
      { path: '/outside.tex', language: 'latex', text: '\\newcommand{\\leak}{}' },
    ] }, '\\newcommand{\\same}[3]{}');
    expect(macros.get('same')).toMatchObject({ required: 3, imported: false });
    expect(macros.get('other')).toMatchObject({ imported: true });
    expect(macros.has('leak')).toBe(false);
  });

  it('scans theorem and environment declarations without comments', () => {
    const environments = scanLatexEnvironmentDeclarations(String.raw`% \newtheorem{hidden}{Hidden}
\newtheorem{assumption}{Assumption}
\newenvironment{remark}{}{}`);
    expect(environments.map(item => item.name)).toEqual(['assumption', 'remark']);
    expect(latexEnvironmentDeclarationLine(String.raw`\newtheorem{assumption}{Assumption}`, 'assumption')).toBe(1);
  });

  it('keeps active environment declarations ahead of workspace snapshots', () => {
    const environments = latexWorkspaceEnvironments({ rootPath: '/paper', activePath: '/paper/main.tex', documents: [
      { path: '/paper/main.tex', language: 'latex', text: String.raw`\newtheorem{claim}{Claim}` },
      { path: '/paper/style.tex', language: 'latex', text: String.raw`\newtheorem{claim}{Old}
\newenvironment{remark}{}{}` },
    ] }, String.raw`\newtheorem{claim}{Current}`);
    expect(environments.get('claim')).toMatchObject({ imported: false });
    expect(environments.get('remark')).toMatchObject({ imported: true });
  });

  it('finds a declaration line while ignoring comments', () => {
    expect(latexMacroDeclarationLine('% \\newcommand{\\hidden}{}\n\\newcommand{\\shown}[1]{}', 'shown')).toBe(2);
    expect(latexMacroDeclarationLine('\\newcommand{\\shown}{}', 'missing')).toBeNull();
  });
});
