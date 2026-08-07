// Snippet completion data — ported from ui-legacy/completions.js.
//
// Each entry:
//   l: trigger / label as the user types it
//   t: snippet template with $1, $2 placeholders (text after the digit is the
//      default placeholder content, e.g. "$1key" => placeholder named/seeded "key")
//   d: short description shown next to the entry in the popup
//
// We translate $1foo style placeholders to CodeMirror snippet ${1:foo} format
// in snippetToCM6 so the completion engine can highlight & cycle through them.

import type { Lang } from '../store';

export interface SnippetEntry {
  l: string;
  t: string;
  d: string;
  /**
   * Typst only: valid inside `$...$` and nowhere else.
   *
   * Typst math is a separate scope with its own syntax — `frac(a, b)` and the
   * greek names below exist only there, and they take no `#`. Without this flag
   * the markup completion would offer `#alpha`, which does not compile.
   */
  math?: true;
  /** LaTeX only: package that must be explicitly loaded for this skeleton. */
  latexPackage?: string;
  /** LaTeX only: the environment is a child of an existing math context. */
  latexInsideMath?: true;
  /** LaTeX only: command is valid only inside one of these environments. */
  latexEnvs?: readonly string[];
}

/**
 * Multi-line LaTeX environment skeletons.
 *
 * The single-command entries that used to live here (`\textbf`, `\frac`, greek
 * letters, operators, symbols — about 130 of them) were removed in favour of the
 * bundled `.cwl` corpus, which covers the same ground far more completely and
 * carries upstream argument names.
 *
 * What the corpus cannot express is an environment *body*: its environment lines
 * hold only a name (`\begin{align}#\math,array`), so these skeletons still own
 * the `\item` / `&` / indentation structure that makes an environment usable the
 * moment it is inserted. `mergeCandidates` dedups by label, and these outrank
 * the corpus stubs.
 *
 * These use the legacy `$1default` dialect (see `snippetToCM6`); cwl candidates
 * bypass that converter via `snippetSyntax: 'cm6'`.
 */
export const LATEX_COMPLETIONS: SnippetEntry[] = [
  // environments
  { l: '\\begin{document}', t: '\\begin{document}\n  $1\n\\end{document}', d: 'document body' },
  { l: '\\begin{itemize}', t: '\\begin{itemize}\n  \\item $1\n\\end{itemize}', d: 'bullet list' },
  { l: '\\begin{enumerate}', t: '\\begin{enumerate}\n  \\item $1\n\\end{enumerate}', d: 'numbered list' },
  { l: '\\begin{description}', t: '\\begin{description}\n  \\item[$1term] $2\n\\end{description}', d: 'description list' },
  { l: '\\begin{equation}', t: '\\begin{equation}\n  $1\n\\end{equation}', d: 'numbered equation' },
  { l: '\\begin{equation*}', latexPackage: 'amsmath', t: '\\begin{equation*}\n  $1\n\\end{equation*}', d: 'unnumbered equation' },
  { l: '\\begin{align}', latexPackage: 'amsmath', t: '\\begin{align}\n  $1\n\\end{align}', d: 'align' },
  { l: '\\begin{align*}', latexPackage: 'amsmath', t: '\\begin{align*}\n  $1\n\\end{align*}', d: 'align (no nums)' },
  { l: '\\begin{gather}', latexPackage: 'amsmath', t: '\\begin{gather}\n  $1\n\\end{gather}', d: 'gather' },
  { l: '\\begin{cases}', latexPackage: 'amsmath', latexInsideMath: true, t: '\\begin{cases}\n  $1 & \\text{if } $2\\\\\n  $3 & \\text{otherwise}\n\\end{cases}', d: 'cases' },
  { l: '\\begin{matrix}', latexPackage: 'amsmath', latexInsideMath: true, t: '\\begin{matrix}\n  $1\n\\end{matrix}', d: 'matrix' },
  { l: '\\begin{pmatrix}', latexPackage: 'amsmath', latexInsideMath: true, t: '\\begin{pmatrix}\n  $1\n\\end{pmatrix}', d: 'paren matrix' },
  { l: '\\begin{bmatrix}', latexPackage: 'amsmath', latexInsideMath: true, t: '\\begin{bmatrix}\n  $1\n\\end{bmatrix}', d: 'bracket matrix' },
  { l: '\\begin{vmatrix}', latexPackage: 'amsmath', latexInsideMath: true, t: '\\begin{vmatrix}\n  $1\n\\end{vmatrix}', d: 'determinant' },
  { l: '\\begin{figure}', t: '\\begin{figure}[ht]\n  \\centering\n  $1\n  \\caption{$2caption}\n\\end{figure}', d: 'figure' },
  { l: '\\begin{table}', t: '\\begin{table}[ht]\n  \\centering\n  $1\n  \\caption{$2caption}\n\\end{table}', d: 'table' },
  { l: '\\begin{tabular}', t: '\\begin{tabular}{$1lll}\n  $2\n\\end{tabular}', d: 'tabular' },
  { l: '\\begin{quote}', t: '\\begin{quote}\n  $1\n\\end{quote}', d: 'quote' },
  { l: '\\begin{center}', t: '\\begin{center}\n  $1\n\\end{center}', d: 'center' },
  { l: '\\begin{verbatim}', t: '\\begin{verbatim}\n$1\n\\end{verbatim}', d: 'verbatim' },
  { l: '\\begin{abstract}', t: '\\begin{abstract}\n  $1\n\\end{abstract}', d: 'abstract' },
  { l: '\\begin{proof}', latexPackage: 'amsthm', t: '\\begin{proof}\n  $1\n\\end{proof}', d: 'proof' },
  { l: '\\item', t: '\\item $1', d: 'list item', latexEnvs: ['itemize', 'enumerate', 'description'] },
];

export const TYPST_COMPLETIONS: SnippetEntry[] = [
  // keywords
  { l: '#set', t: '#set $1text($2)', d: 'set rule' },
  { l: '#show', t: '#show $1: $2', d: 'show rule' },
  { l: '#let', t: '#let $1name = $2', d: 'let binding' },
  { l: '#import', t: '#import "$1file.typ": $2*', d: 'import' },
  { l: '#include', t: '#include "$1file.typ"', d: 'include' },
  { l: '#if', t: '#if $1cond {\n  $2\n}', d: 'if' },
  { l: '#else', t: '#else {\n  $1\n}', d: 'else' },
  { l: '#for', t: '#for $1x in $2range(10) {\n  $3\n}', d: 'for loop' },
  { l: '#while', t: '#while $1cond {\n  $2\n}', d: 'while loop' },
  // set templates
  { l: '#set page', t: '#set page(width: $1auto, height: $2auto, margin: $31cm)', d: 'page setup' },
  { l: '#set text', t: '#set text(font: "$1New Computer Modern", size: $211pt)', d: 'text setup' },
  { l: '#set par', t: '#set par(justify: $1true, leading: $20.65em)', d: 'paragraph' },
  { l: '#set heading', t: '#set heading(numbering: "$11.1")', d: 'heading numbering' },
  { l: '#set list', t: '#set list(indent: $11em)', d: 'list style' },
  { l: '#set enum', t: '#set enum(numbering: "$11.")', d: 'enum style' },
  { l: '#set table', t: '#set table(stroke: $10.5pt)', d: 'table style' },
  { l: '#set math.equation', t: '#set math.equation(numbering: "$1(1)")', d: 'eq numbering' },
  // layout
  { l: 'box', t: 'box[$1body]', d: 'box' },
  { l: 'block', t: 'block[$1body]', d: 'block' },
  { l: 'pad', t: 'pad(x: $11em)[$2]', d: 'pad' },
  { l: 'align', t: 'align($1center)[$2]', d: 'align' },
  { l: 'columns', t: 'columns($12)[$2]', d: 'columns' },
  { l: 'grid', t: 'grid(\n  columns: $12,\n  [$2cell],\n  [$3cell],\n)', d: 'grid' },
  { l: 'stack', t: 'stack(\n  dir: $1ttb,\n  [$2item],\n  [$3item],\n)', d: 'stack' },
  { l: 'place', t: 'place($1top + right)[$2]', d: 'place' },
  { l: 'rotate', t: 'rotate($145deg)[$2]', d: 'rotate' },
  { l: 'scale', t: 'scale(x: $180%)[$2]', d: 'scale' },
  { l: 'pagebreak', t: 'pagebreak()', d: 'page break' },
  { l: 'linebreak', t: 'linebreak()', d: 'line break' },
  // primitives
  { l: 'image', t: 'image("$1path.png", width: $280%)', d: 'image' },
  { l: 'figure', t: 'figure($1image("path.png"), caption: [$2caption])', d: 'figure' },
  { l: 'table', t: 'table(\n  columns: $13,\n  [$2cell],\n  [$3cell],\n)', d: 'table' },
  { l: 'rect', t: 'rect(width: $1100%)[$2]', d: 'rectangle' },
  { l: 'square', t: 'square[$1body]', d: 'square' },
  { l: 'circle', t: 'circle[$1body]', d: 'circle' },
  { l: 'ellipse', t: 'ellipse[$1body]', d: 'ellipse' },
  { l: 'line', t: 'line(start: ($10pt, 0pt), end: ($2100pt, 0pt))', d: 'line' },
  // text
  { l: 'strong', t: 'strong[$1bold]', d: 'bold' },
  { l: 'emph', t: 'emph[$1italic]', d: 'italic' },
  { l: 'underline', t: 'underline[$1]', d: 'underline' },
  { l: 'overline', t: 'overline[$1]', d: 'overline' },
  { l: 'strike', t: 'strike[$1]', d: 'strike' },
  { l: 'highlight', t: 'highlight[$1]', d: 'highlight' },
  { l: 'super', t: 'super[$1]', d: 'superscript' },
  { l: 'sub', t: 'sub[$1]', d: 'subscript' },
  { l: 'smallcaps', t: 'smallcaps[$1]', d: 'small caps' },
  { l: 'upper', t: 'upper[$1]', d: 'uppercase' },
  { l: 'lower', t: 'lower[$1]', d: 'lowercase' },
  { l: 'lorem', t: 'lorem($150)', d: 'lorem ipsum' },
  { l: 'link', t: 'link("$1url")[$2text]', d: 'link' },
  { l: 'cite', t: 'cite(<$1key>)', d: 'citation' },
  { l: 'ref', t: 'ref(<$1key>)', d: 'reference' },
  { l: 'footnote', t: 'footnote[$1]', d: 'footnote' },
  { l: 'outline', t: 'outline(title: [$1Contents])', d: 'outline / TOC' },
  // colors
  { l: 'rgb', t: 'rgb("$1#000000")', d: 'rgb color' },
  { l: 'cmyk', t: 'cmyk($10%, $20%, $30%, $4100%)', d: 'cmyk color' },
  { l: 'luma', t: 'luma($150%)', d: 'grayscale' },
  // math
  { l: 'sum', t: 'sum_($1i=1)^($2n) $3', d: 'sum', math: true },
  { l: 'product', t: 'product_($1i=1)^($2n) $3', d: 'product', math: true },
  { l: 'integral', t: 'integral_($10)^($21) $3', d: 'integral', math: true },
  { l: 'frac', t: 'frac($1a, $2b)', d: 'fraction', math: true },
  { l: 'sqrt', t: 'sqrt($1)', d: 'sqrt', math: true },
  { l: 'root', t: 'root($1n, $2x)', d: 'nth root', math: true },
  { l: 'vec', t: 'vec($1)', d: 'vector', math: true },
  { l: 'mat', t: 'mat($1)', d: 'matrix', math: true },
  { l: 'cases', t: 'cases($1)', d: 'cases', math: true },
  { l: 'binom', t: 'binom($1n, $2k)', d: 'binomial', math: true },
  { l: 'abs', t: 'abs($1)', d: 'abs', math: true },
  { l: 'norm', t: 'norm($1)', d: 'norm', math: true },
  // greek for math
  ...[
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda',
    'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
  ].map(s => ({ l: s, t: s + ' ', d: 'greek (math)', math: true as const })),
];

export const MARKDOWN_COMPLETIONS: SnippetEntry[] = [
  { l: 'h1', t: '# $1Heading\n', d: 'heading 1' },
  { l: 'h2', t: '## $1Heading\n', d: 'heading 2' },
  { l: 'h3', t: '### $1Heading\n', d: 'heading 3' },
  { l: 'h4', t: '#### $1Heading\n', d: 'heading 4' },
  { l: 'bold', t: '**$1text**', d: 'bold' },
  { l: 'italic', t: '*$1text*', d: 'italic' },
  { l: 'bolditalic', t: '***$1text***', d: 'bold italic' },
  { l: 'strike', t: '~~$1text~~', d: 'strike' },
  { l: 'code', t: '`$1code`', d: 'inline code' },
  { l: 'codeblock', t: '```$1js\n$2\n```\n', d: 'code block' },
  { l: 'link', t: '[$1text]($2url)', d: 'link' },
  { l: 'image', t: '![$1alt]($2url)', d: 'image' },
  { l: 'list', t: '- $1item\n- $2\n- $3\n', d: 'bullet list' },
  { l: 'numlist', t: '1. $1item\n2. $2\n3. $3\n', d: 'numbered list' },
  { l: 'table', t: '| $1col1 | $2col2 |\n| --- | --- |\n| $3 | $4 |\n', d: 'table' },
  { l: 'quote', t: '> $1quote\n', d: 'blockquote' },
  { l: 'hr', t: '---\n', d: 'horizontal rule' },
  { l: 'math', t: '$$1E=mc^2$', d: 'inline math' },
  { l: 'mathblock', t: '$$\n$1\n$$\n', d: 'display math' },
  { l: 'task', t: '- [ ] $1todo\n', d: 'task' },
  { l: 'taskdone', t: '- [x] $1done\n', d: 'done task' },
  { l: 'details', t: '<details>\n<summary>$1Summary</summary>\n\n$2\n\n</details>\n', d: 'collapsible' },
  { l: 'frontmatter', t: '---\ntitle: $1Title\nauthor: $2Name\ndate: $32026-01-01\n---\n\n', d: 'YAML front matter' },
  { l: 'callout-note', t: '> [!NOTE]\n> $1\n', d: 'note callout' },
  { l: 'callout-tip', t: '> [!TIP]\n> $1\n', d: 'tip callout' },
  { l: 'callout-warn', t: '> [!WARNING]\n> $1\n', d: 'warning callout' },
  { l: 'kbd', t: '<kbd>$1Ctrl</kbd>', d: 'keyboard key' },
];

export function snippetsForLang(lang: Lang): SnippetEntry[] {
  switch (lang) {
    case 'latex':
      return LATEX_COMPLETIONS;
    case 'typst':
      return TYPST_COMPLETIONS;
    case 'markdown':
      return MARKDOWN_COMPLETIONS;
  }
}

/**
 * Translate a legacy-style "$1foo" template into CodeMirror 6's `${1:foo}`
 * snippet syntax. CodeMirror's parser walks "$N" or "${N:default}", so we need
 * the explicit braces to attach default text to a numbered placeholder.
 *
 * A literal "$" (e.g. inline math `$$1E=mc^2$` in the markdown `math` snippet)
 * is emitted as a bare "$". CodeMirror's `Snippet.parse` only treats "$" as
 * special when it is followed by "{" or a digit, and it only unescapes `\{` and
 * `\}` — never `\$` — so escaping the dollar itself would leave a stray
 * backslash in the inserted text. A literal "${" is therefore escaped as "$\{".
 *
 * Note for future Typst snippets: CodeMirror treats "#{" as a field opener too
 * (its pattern is `[#$]\{`). No current snippet contains one; a new template
 * needing a literal `#{` must escape the brace the same way.
 */
export function snippetToCM6(template: string): string {
  // Promote $<digit><word> to ${<digit>:<word>}; leave other "$" literal.
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const ch = template[i];
    if (ch === '$') {
      const next = template[i + 1];
      if (next && /[0-9]/.test(next)) {
        // Read the digits, then the optional default text (until a non-word
        // boundary). Default text is anything up to space, brace, paren,
        // bracket, comma, newline, backslash, or another $.
        // Legacy templates use a single digit for the field number. Any
        // following digits belong to the default value (`$10.8` = field 1,
        // default `0.8`; `$32026-01-01` = field 3, default date).
        const num = next;
        const j = i + 2;
        // Default text: stop at whitespace, structural chars, or $.
        let k = j;
        while (k < template.length && /[A-Za-z0-9_\-.]/.test(template[k])) k++;
        const def = template.slice(j, k);
        out += def ? `\${${num}:${def}}` : `\${${num}}`;
        i = k - 1;
      } else if (next === '{') {
        // Literal "${" would otherwise open a CM6 field. Escape the brace, not
        // the dollar, because CM6 unescapes braces only.
        out += '$\\{';
        i++;
      } else {
        // Literal $ — CM6 inserts it verbatim.
        out += '$';
      }
    } else {
      out += ch;
    }
  }
  return out;
}
