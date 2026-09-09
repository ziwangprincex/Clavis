import type { Lang } from '../store/tabs';
export type DiagnosticAction = 'source' | 'environment' | 'full-build' | 'engine';
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
    pattern: /undefined.*(reference|citation)|rerun|biber|bibtex|cross.reference/i,
    result: {
      explanation:
        'References need another pass or bibliography processing. Run a full build; then verify citation keys if they remain unresolved.',
      action: 'full-build',
      label: 'Full build',
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
        'Start at the reported source location. The original compiler message remains above; no automatic rewrite is applied.',
      action: 'source',
      label: 'Go to source',
    }
  );
}
