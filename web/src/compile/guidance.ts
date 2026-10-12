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
    pattern: /^(?:Error: )?main document not found on disk/i,
    result: {
      explanation: 'The main document is not at its saved location; it may have been moved or deleted. Save it again with Save As, then compile.',
      action: 'none',
      label: '',
    },
  },
  {
    language: 'latex',
    pattern: /(?:pdf|xe|lua)latex not found in PATH|custom path for .* not found/i,
    result: {
      explanation: 'The LaTeX executable was not found. Install a TeX distribution or configure its path in Settings → LaTeX. The document remains editable.',
      action: 'environment',
      label: 'Check environment',
    },
  },
  {
    language: 'latex',
    pattern: /^(?:biber|bibtex) (?:not found in PATH|not available)/i,
    result: {
      explanation: 'The bibliography processor was not found. Check that the backend selected by the document (bibtex or biber) is installed and available in the TeX environment. Recompiling does not install it.',
      action: 'environment',
      label: 'Check environment',
    },
  },
  {
    language: 'latex',
    pattern: /^missing bibliography database:|couldn't open (?:database|style) file|file.*\.(?:bib|bst).*not found/i,
    result: {
      explanation: 'The bibliography database (.bib) or style (.bst) could not be opened. Check the named file and its path relative to the main document. Recompiling does not restore a missing file.',
      action: 'source',
      label: 'Check source path',
    },
  },
  {
    pattern: /font.*(cannot be found|not found|unknown)|font-not-found|unknown font/i,
    result: {
      explanation:
        'The named font was not found. Check its spelling in the source (including spaces inside the braces), the file path relative to the main document, and whether the font is installed. Changing the engine does not resolve this.',
      action: 'source',
      label: 'Check font name',
    },
  },
  {
    pattern: /fontspec.*requires|unicode character|not set up for use with latex|inputenc error/i,
    result: {
      explanation:
        'The document uses fontspec or Unicode text that pdfLaTeX does not support. Select XeLaTeX or LuaLaTeX under Typesetting.',
      action: 'engine',
      label: 'Engine settings',
    },
  },
  {
    pattern: /not cached|package.*not found|file.*not found|cannot find file|could not find file/i,
    result: {
      explanation:
        'Check the path relative to the project main document and the installed package version. Typst packages are downloaded only after confirmation.',
      action: 'source',
      label: 'Check source path',
    },
  },
  {
    pattern: /not installed|executable|command not found|failed to spawn|engine.*not found/i,
    result: {
      explanation:
        'The typesetting engine is unavailable. Check the local installation and the configured executable path. Nothing is installed automatically.',
      action: 'environment',
      label: 'Check environment',
    },
  },
  {
    language: 'latex',
    pattern: /^bibliography entry:/i,
    result: {
      explanation:
        'The .bib entry at this line is malformed or duplicated; bibtex/biber skipped it, so citations of it remain unresolved. The usual cause is a missing comma or brace in the preceding field. Correct the entry and compile again.',
      action: 'source',
      label: 'Open .bib entry',
    },
  },
  {
    language: 'latex',
    pattern: /^(?:biber|bibtex) (?:exited with code|failed)/i,
    result: {
      explanation:
        'The bibliography processor reported a failure. The raw output contains the specific error; check the named .bib entry, file or backend setting. Recompiling without correcting the cause repeats the failure.',
      action: 'none',
      label: '',
    },
  },
  {
    language: 'latex',
    pattern: /label.*multiply[ -]defined|multiply[ -]defined labels/i,
    result: {
      explanation: 'The same label is defined more than once. Rename or remove the duplicate definition; recompiling does not resolve this.',
      action: 'source',
      label: 'Inspect source',
    },
  },
  {
    language: 'latex',
    pattern: /undefined.*(reference|citation)|rerun|\(re\)run|cross.reference|citation.*undefined/i,
    result: {
      explanation:
        'Cross-references and citations may require additional passes. Compile again with latexmk. If they remain unresolved, check earlier bibliography errors, the loaded .bib files, and the spelling of citation keys and labels.',
      action: 'full-build',
      label: 'Compile again with latexmk',
    },
  },
  {
    pattern: /undefined control sequence|unknown variable|unknown function/i,
    result: {
      explanation:
        'Check the spelling, and that the command is defined or imported before this use. Formula previews do not include document macros.',
      action: 'source',
      label: 'Go to source',
    },
  },
  {
    pattern: /expected|unclosed|missing.*[}$]|runaway argument|mismatched/i,
    result: {
      explanation:
        'Check this line and the preceding one for an unmatched brace, bracket, delimiter or environment.',
      action: 'source',
      label: 'Inspect source',
    },
  },
  {
    pattern: /overfull|underfull/i,
    result: {
      explanation:
        'The document compiled, but this line exceeds the available width. Adjust the wording, line break or figure width instead of suppressing the warning.',
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
        'The compiler message above is shown unchanged. If it includes a line number, the error is at or before that line; otherwise, the lines preceding it in the raw output usually identify the cause.',
      action: 'source',
      label: 'Go to line',
    }
  );
}
