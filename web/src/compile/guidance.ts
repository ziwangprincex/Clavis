import type { Lang } from '../store/tabs';
export type DiagnosticAction = 'source' | 'environment' | 'full-build' | 'engine' | 'none';
export interface Guidance {
  explanation: string;
  action: DiagnosticAction;
  label: string;
}
const rules: { language?: Lang; pattern: RegExp; result: Guidance }[] = [
  {
    language: 'latex',
    pattern: /(?:pdf|xe|lua)latex not found in PATH|custom path for .* not found/i,
    result: {
      explanation: 'The LaTeX executable could not be found. Install a TeX distribution or configure its path in Settings → LaTeX; your document can still be edited.',
      action: 'environment',
      label: 'Check environment',
    },
  },
  {
    language: 'latex',
    pattern: /^(?:biber|bibtex) (?:not found in PATH|not available)/i,
    result: {
      explanation: 'The bibliography tool could not be found. Check that the backend selected by the document (bibtex or biber) is installed and available in the TeX environment. Recompiling alone will not install it.',
      action: 'environment',
      label: 'Check environment',
    },
  },
  {
    language: 'latex',
    pattern: /^missing bibliography database:|couldn't open (?:database|style) file|file.*\.(?:bib|bst).*not found/i,
    result: {
      explanation: 'The bibliography database (.bib) or style (.bst) could not be opened. Check the named file and its path relative to the main document; another compile will not restore a missing file.',
      action: 'source',
      label: 'Check source path',
    },
  },
  {
    pattern: /not cached|package.*not found|file.*not found|cannot find file|could not find file/i,
    result: {
      explanation:
        'Check the path relative to the project main and the installed package version. Typst package downloads require your confirmation.',
      action: 'source',
      label: 'Check source path',
    },
  },
  {
    pattern: /font.*(not found|unknown)|unknown font|fontspec|unicode character/i,
    result: {
      explanation:
        'Check installed fonts. For a Unicode or fontspec LaTeX document, select XeLaTeX or LuaLaTeX in Typesetting.',
      action: 'engine',
      label: 'Engine and font settings',
    },
  },
  {
    pattern: /not installed|executable|command not found|failed to spawn|engine.*not found/i,
    result: {
      explanation:
        'The typesetting engine is unavailable. Check the local installation and configured executable path; nothing will be installed automatically.',
      action: 'environment',
      label: 'Check environment',
    },
  },
  {
    language: 'latex',
    pattern: /^bibliography entry:/i,
    result: {
      explanation:
        'The .bib file has a malformed or duplicated entry at this line; bibtex/biber skipped it, so any citation of it stays unresolved. Fix the entry (usually a missing comma or brace on the previous field) and recompile.',
      action: 'source',
      label: 'Open .bib entry',
    },
  },
  {
    language: 'latex',
    pattern: /^(?:biber|bibtex) (?:exited with code|failed)/i,
    result: {
      explanation:
        'The bibliography processor reported a failure. Expand the raw output for its specific error, then check the named .bib entry, file or backend setting. Running it again without fixing the cause may repeat the failure.',
      action: 'none',
      label: '',
    },
  },
  {
    language: 'latex',
    pattern: /label.*multiply[ -]defined|multiply[ -]defined labels/i,
    result: {
      explanation: 'The same label is defined more than once. Find its label definitions in the project and rename or remove the duplicate; compiling again alone cannot fix this.',
      action: 'source',
      label: 'Inspect source',
    },
  },
  {
    language: 'latex',
    pattern: /undefined.*(reference|citation)|rerun|\(re\)run|cross.reference|citation.*undefined/i,
    result: {
      explanation:
        'Cross references and citations may need additional passes. Compile again with latexmk. If they remain unresolved, check earlier bibliography errors, the loaded .bib files and the spelling of citation keys or labels.',
      action: 'full-build',
      label: 'Compile again with latexmk',
    },
  },
  {
    pattern: /undefined control sequence|unknown variable|unknown function/i,
    result: {
      explanation:
        'Check spelling and the definition/import before this use. A formula-only preview does not inherit document macros.',
      action: 'source',
      label: 'Go to source',
    },
  },
  {
    pattern: /expected|unclosed|missing.*[}$]|runaway argument|mismatched/i,
    result: {
      explanation:
        'Inspect this location and the preceding line for an unmatched brace, bracket, delimiter or environment.',
      action: 'source',
      label: 'Inspect source',
    },
  },
  {
    pattern: /overfull|underfull/i,
    result: {
      explanation:
        'The document compiled, but this line does not fit comfortably. Adjust the wording, line break or figure width rather than hiding the warning.',
      action: 'source',
      label: 'Inspect line',
    },
  },
];
export function guidance(language: Lang, message: string): Guidance {
  return (
    rules.find((rule) => (!rule.language || rule.language === language) && rule.pattern.test(message))
      ?.result ?? {
      explanation:
        'The compiler message above is shown as-is. If it names a line, start there; otherwise open the raw output below to see what came just before it.',
      action: 'source',
      label: 'Go to line',
    }
  );
}
