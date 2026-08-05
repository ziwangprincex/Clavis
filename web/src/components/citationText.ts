import type { Lang } from '../store/tabs';

export function citationsText(keys: readonly string[], language: Lang): string {
  const unique = [...new Set(keys.map(key => key.trim()).filter(Boolean))];
  if (unique.length === 0) return '';
  if (language === 'typst') return unique.map(key => `@${key}`).join(' ');
  if (language === 'markdown') return `[${unique.map(key => `@${key}`).join('; ')}]`;
  return '\\cite{' + unique.join(', ') + '}';
}

export function citationText(key: string, language: Lang): string {
  return citationsText([key], language);
}
