// To-do notes left in the source, listed in the sidebar like Texifier's TODOs
// tab: `% TODO …` and `\todo{…}` in LaTeX, `// TODO …` in Typst and
// `<!-- TODO … -->` in Markdown. FIXME counts too.

import type { Lang } from '../store';

export interface TodoItem { line: number; text: string }

const NOTE = '(?:TODO|FIXME)\\b[:：]?\\s*';
const LATEX_COMMENT = new RegExp(`(?<!\\\\)%\\s*${NOTE}(.*)$`, 'i');
const LATEX_TODO = /\\todo(?:\[[^\]]*\])?\{([^{}]*)\}/;
/** Not the `//` of a URL such as `https://todo.example`. */
const TYPST_COMMENT = new RegExp(`(?<![:/])//\\s*${NOTE}(.*)$`, 'i');
const MARKDOWN_COMMENT = new RegExp(`<!--\\s*${NOTE}(.*?)\\s*(?:-->|$)`, 'i');
const FENCE = /^\s{0,3}(?:```|~~~)/;

function todoOn(line: string, lang: Lang): string | null {
  if (lang === 'latex') {
    const comment = LATEX_COMMENT.exec(line);
    if (comment) return comment[1];
    // A `\todo{}` inside a comment is switched off.
    return LATEX_TODO.exec(line.replace(/(?<!\\)%.*$/, ''))?.[1] ?? null;
  }
  return (lang === 'typst' ? TYPST_COMMENT : MARKDOWN_COMMENT).exec(line)?.[1] ?? null;
}

export function findTodos(text: string, lang: Lang): TodoItem[] {
  const todos: TodoItem[] = [];
  let inCode = false;
  text.split('\n').forEach((line, index) => {
    // A note shown inside a Markdown code block is an example, not a to-do.
    if (lang === 'markdown' && FENCE.test(line)) inCode = !inCode;
    if (inCode) return;
    const found = todoOn(line, lang);
    if (found !== null) todos.push({ line: index + 1, text: found.trim() || 'TODO' });
  });
  return todos;
}
