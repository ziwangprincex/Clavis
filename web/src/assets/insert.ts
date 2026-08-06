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
