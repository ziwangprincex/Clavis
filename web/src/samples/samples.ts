// Sample documents — shown in the seed tabs on first launch so the UI is not empty.

import type { Lang } from '../store';

export const SAMPLES: Record<Lang, string> = {
  markdown: `# Welcome to Clavis

Clavis is a desktop editor for **Markdown**, **LaTeX**, and **Typst** with live preview.

## Features

- Markdown with KaTeX math: $E = mc^2$
- LaTeX compiled by your local engine (\`pdflatex\` / \`xelatex\` / \`lualatex\`)
- Typst rendered by an embedded engine
- Project-aware sidebar: outline, folder tree, files, bibliography
- SyncTeX forward & reverse jumping

## Quick math demo

Inline: $\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$

Display:

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

## Code

\`\`\`python
def hello():
    print("Welcome to Clavis")
\`\`\`

> Press **Ctrl+Shift+P** to open the command palette.
`,

  latex: `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath, amssymb}
\\usepackage{hyperref}

\\title{Welcome to Clavis}
\\author{Clavis User}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Welcome to \\textbf{Clavis} --- a desktop editor for Markdown, LaTeX, and Typst.
This document is compiled by your local LaTeX engine
(\\texttt{pdflatex} by default, configurable in Settings).

\\section{Math}
Clavis renders display math with the system engine, e.g.
\\begin{equation}
    e^{i\\pi} + 1 = 0.
\\end{equation}

\\subsection{Inline}
The Gaussian integral $\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$
is a useful identity in probability and physics.

\\section{Tips}
\\begin{itemize}
    \\item Press \\textbf{Ctrl+B} to compile.
    \\item Use the sidebar's \\emph{Outline} to jump between sections.
    \\item Toggle \\textbf{Auto} in the toolbar for live recompile on save.
\\end{itemize}

\\end{document}
`,

  typst: `= Welcome to Clavis

Clavis is a desktop editor for *Markdown*, *LaTeX*, and *Typst* with live preview.

== Features

- Embedded Typst engine — no external install needed
- Live SVG preview as you type
- Math, code, tables, figures all supported

== Math

Inline: $E = m c^2$

Display:
$ integral_0^infinity e^(-x^2) dif x = sqrt(pi) / 2 $

== Code

\`\`\`rust
fn main() {
    println!("Welcome to Clavis");
}
\`\`\`

== Tips

#emph[Press Ctrl+Shift+P to open the command palette.]
`,
};
