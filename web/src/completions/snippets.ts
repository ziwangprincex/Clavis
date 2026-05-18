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
}

export const LATEX_COMPLETIONS: SnippetEntry[] = [
  // structure
  { l: '\\documentclass', t: '\\documentclass{$1article}', d: 'document class' },
  { l: '\\usepackage', t: '\\usepackage{$1}', d: 'load package' },
  { l: '\\title', t: '\\title{$1Title}', d: 'document title' },
  { l: '\\author', t: '\\author{$1Name}', d: 'document author' },
  { l: '\\date', t: '\\date{$1\\today}', d: 'document date' },
  { l: '\\maketitle', t: '\\maketitle', d: 'render title block' },
  { l: '\\tableofcontents', t: '\\tableofcontents', d: 'table of contents' },
  { l: '\\newpage', t: '\\newpage', d: 'new page' },
  { l: '\\clearpage', t: '\\clearpage', d: 'flush floats + new page' },
  { l: '\\section', t: '\\section{$1Title}', d: 'section' },
  { l: '\\subsection', t: '\\subsection{$1Title}', d: 'subsection' },
  { l: '\\subsubsection', t: '\\subsubsection{$1Title}', d: 'subsubsection' },
  { l: '\\paragraph', t: '\\paragraph{$1Title}', d: 'paragraph' },
  { l: '\\chapter', t: '\\chapter{$1Title}', d: 'chapter' },
  // formatting
  { l: '\\textbf', t: '\\textbf{$1bold}', d: 'bold' },
  { l: '\\textit', t: '\\textit{$1italic}', d: 'italic' },
  { l: '\\textsl', t: '\\textsl{$1slanted}', d: 'slanted' },
  { l: '\\textsc', t: '\\textsc{$1Small Caps}', d: 'small caps' },
  { l: '\\textsf', t: '\\textsf{$1sans}', d: 'sans serif' },
  { l: '\\emph', t: '\\emph{$1emphasis}', d: 'emphasis' },
  { l: '\\texttt', t: '\\texttt{$1code}', d: 'monospace' },
  { l: '\\underline', t: '\\underline{$1text}', d: 'underline' },
  { l: '\\textcolor', t: '\\textcolor{$1red}{$2text}', d: 'colored text' },
  { l: '\\href', t: '\\href{$1url}{$2text}', d: 'hyperlink' },
  { l: '\\url', t: '\\url{$1url}', d: 'url' },
  { l: '\\footnote', t: '\\footnote{$1note}', d: 'footnote' },
  { l: '\\cite', t: '\\cite{$1key}', d: 'citation' },
  { l: '\\ref', t: '\\ref{$1key}', d: 'reference' },
  { l: '\\eqref', t: '\\eqref{$1key}', d: 'equation ref' },
  { l: '\\label', t: '\\label{$1key}', d: 'label' },
  { l: '\\caption', t: '\\caption{$1caption}', d: 'caption' },
  { l: '\\includegraphics', t: '\\includegraphics[width=$10.8\\linewidth]{$2path}', d: 'image' },
  // environments
  { l: '\\begin{itemize}', t: '\\begin{itemize}\n  \\item $1\n\\end{itemize}', d: 'bullet list' },
  { l: '\\begin{enumerate}', t: '\\begin{enumerate}\n  \\item $1\n\\end{enumerate}', d: 'numbered list' },
  { l: '\\begin{description}', t: '\\begin{description}\n  \\item[$1term] $2\n\\end{description}', d: 'description list' },
  { l: '\\begin{equation}', t: '\\begin{equation}\n  $1\n\\end{equation}', d: 'numbered equation' },
  { l: '\\begin{equation*}', t: '\\begin{equation*}\n  $1\n\\end{equation*}', d: 'unnumbered equation' },
  { l: '\\begin{align}', t: '\\begin{align}\n  $1\n\\end{align}', d: 'align' },
  { l: '\\begin{align*}', t: '\\begin{align*}\n  $1\n\\end{align*}', d: 'align (no nums)' },
  { l: '\\begin{gather}', t: '\\begin{gather}\n  $1\n\\end{gather}', d: 'gather' },
  { l: '\\begin{cases}', t: '\\begin{cases}\n  $1 & \\text{if } $2\\\\\n  $3 & \\text{otherwise}\n\\end{cases}', d: 'cases' },
  { l: '\\begin{matrix}', t: '\\begin{matrix}\n  $1\n\\end{matrix}', d: 'matrix' },
  { l: '\\begin{pmatrix}', t: '\\begin{pmatrix}\n  $1\n\\end{pmatrix}', d: 'paren matrix' },
  { l: '\\begin{bmatrix}', t: '\\begin{bmatrix}\n  $1\n\\end{bmatrix}', d: 'bracket matrix' },
  { l: '\\begin{vmatrix}', t: '\\begin{vmatrix}\n  $1\n\\end{vmatrix}', d: 'determinant' },
  { l: '\\begin{figure}', t: '\\begin{figure}[ht]\n  \\centering\n  $1\n  \\caption{$2caption}\n\\end{figure}', d: 'figure' },
  { l: '\\begin{table}', t: '\\begin{table}[ht]\n  \\centering\n  $1\n  \\caption{$2caption}\n\\end{table}', d: 'table' },
  { l: '\\begin{tabular}', t: '\\begin{tabular}{$1lll}\n  $2\n\\end{tabular}', d: 'tabular' },
  { l: '\\begin{quote}', t: '\\begin{quote}\n  $1\n\\end{quote}', d: 'quote' },
  { l: '\\begin{center}', t: '\\begin{center}\n  $1\n\\end{center}', d: 'center' },
  { l: '\\begin{verbatim}', t: '\\begin{verbatim}\n$1\n\\end{verbatim}', d: 'verbatim' },
  { l: '\\begin{abstract}', t: '\\begin{abstract}\n  $1\n\\end{abstract}', d: 'abstract' },
  { l: '\\begin{theorem}', t: '\\begin{theorem}\n  $1\n\\end{theorem}', d: 'theorem' },
  { l: '\\begin{lemma}', t: '\\begin{lemma}\n  $1\n\\end{lemma}', d: 'lemma' },
  { l: '\\begin{proof}', t: '\\begin{proof}\n  $1\n\\end{proof}', d: 'proof' },
  { l: '\\item', t: '\\item $1', d: 'list item' },
  // sizes
  ...['tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge'].map(
    s => ({ l: '\\' + s, t: '\\' + s + ' ', d: 'font size' }),
  ),
  // greek
  ...[
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota',
    'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'sigma', 'varsigma', 'tau', 'upsilon',
    'phi', 'varphi', 'chi', 'psi', 'omega',
    'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
  ].map(s => ({ l: '\\' + s, t: '\\' + s + ' ', d: 'greek' })),
  // functions
  ...[
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
    'log', 'ln', 'lg', 'exp', 'min', 'max', 'sup', 'inf', 'lim', 'limsup', 'liminf',
    'det', 'dim', 'ker', 'arg', 'deg', 'gcd', 'Pr',
  ].map(s => ({ l: '\\' + s, t: '\\' + s + ' ', d: 'function' })),
  // big operators
  ...[
    'sum', 'prod', 'coprod', 'int', 'iint', 'iiint', 'iiiint', 'oint', 'bigcup', 'bigcap', 'bigvee',
    'bigwedge', 'bigoplus', 'bigotimes',
  ].map(s => ({ l: '\\' + s, t: '\\' + s + ' ', d: 'big operator' })),
  // math constructs
  { l: '\\frac', t: '\\frac{$1num}{$2den}', d: 'fraction' },
  { l: '\\dfrac', t: '\\dfrac{$1num}{$2den}', d: 'display fraction' },
  { l: '\\binom', t: '\\binom{$1n}{$2k}', d: 'binomial' },
  { l: '\\sqrt', t: '\\sqrt{$1}', d: 'square root' },
  { l: '\\overline', t: '\\overline{$1}', d: 'overline' },
  { l: '\\hat', t: '\\hat{$1}', d: 'hat' },
  { l: '\\widehat', t: '\\widehat{$1}', d: 'wide hat' },
  { l: '\\bar', t: '\\bar{$1}', d: 'bar' },
  { l: '\\vec', t: '\\vec{$1}', d: 'vector' },
  { l: '\\dot', t: '\\dot{$1}', d: 'dot' },
  { l: '\\ddot', t: '\\ddot{$1}', d: 'ddot' },
  { l: '\\tilde', t: '\\tilde{$1}', d: 'tilde' },
  { l: '\\left', t: '\\left$1( $2 \\right$3)', d: 'left/right delim' },
  // symbols
  ...[
    'infty', 'partial', 'nabla', 'cdot', 'cdots', 'ldots', 'dots', 'vdots', 'ddots',
    'times', 'div', 'pm', 'mp', 'ast', 'star', 'circ', 'bullet', 'oplus', 'ominus', 'otimes', 'oslash',
    'leq', 'geq', 'll', 'gg', 'neq', 'approx', 'equiv', 'sim', 'simeq', 'cong', 'propto',
    'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'leftrightarrow', 'Leftrightarrow',
    'longrightarrow', 'longleftarrow', 'to', 'mapsto', 'hookrightarrow',
    'forall', 'exists', 'nexists', 'in', 'notin', 'ni', 'subset', 'subseteq', 'supset', 'supseteq',
    'cup', 'cap', 'setminus', 'emptyset', 'varnothing', 'wedge', 'vee', 'neg', 'top', 'bot',
    'mathbb', 'mathbf', 'mathcal', 'mathfrak', 'mathrm', 'mathsf', 'mathtt', 'boldsymbol',
    'aleph', 'hbar', 'ell', 'Re', 'Im', 'wp', 'prime', 'dagger', 'ddagger',
    'angle', 'triangle', 'square', 'quad', 'qquad',
    'because', 'therefore', 'iff', 'implies', 'vdash', 'dashv',
  ].map(s => ({ l: '\\' + s, t: '\\' + s + ' ', d: 'symbol' })),
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
  { l: 'box', t: 'box($1)', d: 'box' },
  { l: 'block', t: 'block($1)', d: 'block' },
  { l: 'pad', t: 'pad($11em, $2)', d: 'pad' },
  { l: 'align', t: 'align($1center, $2)', d: 'align' },
  { l: 'columns', t: 'columns($12, $2)', d: 'columns' },
  { l: 'grid', t: 'grid(\n  columns: $12,\n  $2\n)', d: 'grid' },
  { l: 'stack', t: 'stack($1dir: ttb, $2)', d: 'stack' },
  { l: 'place', t: 'place($1top + right, $2)', d: 'place' },
  { l: 'rotate', t: 'rotate($145deg, $2)', d: 'rotate' },
  { l: 'scale', t: 'scale($180%, $2)', d: 'scale' },
  { l: 'pagebreak', t: 'pagebreak()', d: 'page break' },
  { l: 'linebreak', t: 'linebreak()', d: 'line break' },
  // primitives
  { l: 'image', t: 'image("$1path.png", width: $280%)', d: 'image' },
  { l: 'figure', t: 'figure($1image("path.png"), caption: [$2caption])', d: 'figure' },
  { l: 'table', t: 'table(\n  columns: $13,\n  $2\n)', d: 'table' },
  { l: 'rect', t: 'rect(width: $1100%, $2)', d: 'rectangle' },
  { l: 'square', t: 'square($1)', d: 'square' },
  { l: 'circle', t: 'circle($1)', d: 'circle' },
  { l: 'ellipse', t: 'ellipse($1)', d: 'ellipse' },
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
  { l: 'sum', t: 'sum_($1i=1)^($2n) $3', d: 'sum' },
  { l: 'prod', t: 'prod_($1i=1)^($2n) $3', d: 'product' },
  { l: 'integral', t: 'integral_($10)^($21) $3', d: 'integral' },
  { l: 'frac', t: 'frac($1a, $2b)', d: 'fraction' },
  { l: 'sqrt', t: 'sqrt($1)', d: 'sqrt' },
  { l: 'root', t: 'root($1n, $2x)', d: 'nth root' },
  { l: 'vec', t: 'vec($1)', d: 'vector' },
  { l: 'mat', t: 'mat($1)', d: 'matrix' },
  { l: 'cases', t: 'cases($1)', d: 'cases' },
  { l: 'binom', t: 'binom($1n, $2k)', d: 'binomial' },
  { l: 'abs', t: 'abs($1)', d: 'abs' },
  { l: 'norm', t: 'norm($1)', d: 'norm' },
  // greek for math
  ...[
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda',
    'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
  ].map(s => ({ l: s, t: s + ' ', d: 'greek (math)' })),
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
 * We also need to escape literal "$" when not followed by a digit (e.g. inline
 * math `$$1E=mc^2$` in the markdown `math` snippet, where the leading "$" is
 * literal). The escape in CM snippets is "\\$".
 */
export function snippetToCM6(template: string): string {
  // Escape literal $ first (anywhere not followed by a digit), then promote
  // $<digit><word> to ${<digit>:<word>}.
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const ch = template[i];
    if (ch === '$') {
      const next = template[i + 1];
      if (next && /[0-9]/.test(next)) {
        // Read the digits, then the optional default text (until a non-word
        // boundary). Default text is anything up to space, brace, paren,
        // bracket, comma, newline, backslash, or another $.
        let j = i + 1;
        while (j < template.length && /[0-9]/.test(template[j])) j++;
        const num = template.slice(i + 1, j);
        // Default text: stop at whitespace, structural chars, or $.
        let k = j;
        while (k < template.length && /[A-Za-z0-9_\-.]/.test(template[k])) k++;
        const def = template.slice(j, k);
        out += def ? `\${${num}:${def}}` : `\${${num}}`;
        i = k - 1;
      } else {
        // Literal $
        out += '\\$';
      }
    } else {
      out += ch;
    }
  }
  return out;
}
