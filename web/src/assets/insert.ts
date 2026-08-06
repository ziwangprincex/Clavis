import type { Lang } from '../store';

function cleanPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function latexPath(path: string): string {
  return cleanPath(path).replace(/([{}%#])/g, '\\$1');
}

function typstPath(path: string): string {
  return cleanPath(path).replace(/(["\\])/g, '\\$1');
}

function markdownPath(path: string): string {
  return cleanPath(path).replace(/[()]/g, '\\$&').replace(/ /g, '%20');
}

/** Language-aware text for inserting a workspace asset reference. */
export function assetInsertText(relativePath: string, language: Lang): string {
  if (language === 'latex') return `\\includegraphics{${latexPath(relativePath)}}`;
  if (language === 'typst') return `#image("${typstPath(relativePath)}")`;
  return `![](${markdownPath(relativePath)})`;
}

/** A manuscript-ready figure skeleton with visible caption/label placeholders. */
export function assetFigureTemplate(relativePath: string, language: Lang): string {
  if (language === 'latex') return `\\begin{figure}[htbp]
  \\centering
  \\includegraphics[width=\\linewidth]{${latexPath(relativePath)}}
  \\caption{Caption}
  \\label{fig:label}
\\end{figure}`;
  if (language === 'typst') return `#figure(
  image("${typstPath(relativePath)}", width: 100%),
  caption: [Caption],
) <fig:label>`;
  return `![Caption](${markdownPath(relativePath)}){#fig:label}`;
}
