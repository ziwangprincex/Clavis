// To-do notes left in the source, listed in the sidebar like Texifier's TODOs
// tab: `% TODO …` and `\todo{…}` in LaTeX, `// TODO …` in Typst and
// `<!-- TODO … -->` in Markdown. FIXME counts too.

import type { Lang } from '../store';

export interface TodoItem { line: number; text: string }

const PATTERNS: Record<Lang, RegExp[]> = {
  latex: [/(?<!\\)%\s*(?:TODO|FIXME)\b[:：]?\s*(.*)$/i, /\\todo(?:\[[^\]]*\])?\{([^{}]*)\}/],
  typst: [/\/\/\s*(?:TODO|FIXME)\b[:：]?\s*(.*)$/i],
  markdown: [/<!--\s*(?:TODO|FIXME)\b[:：]?\s*(.*?)\s*(?:-->|$)/i],
};

export function findTodos(text: string, lang: Lang): TodoItem[] {
  const todos: TodoItem[] = [];
  text.split('\n').forEach((line, index) => {
    for (const pattern of PATTERNS[lang]) {
      const match = pattern.exec(line);
      if (match) {
        todos.push({ line: index + 1, text: match[1].trim() || 'TODO' });
        break;
      }
    }
  });
  return todos;
}
