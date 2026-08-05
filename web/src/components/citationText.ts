import type { Lang } from '../store/tabs';

export function citationText(key: string, language: Lang): string {
  if (language === 'typst') return `@${key}`;
  if (language === 'markdown') return `[@${key}]`;
  return `\\cite{${key}}`;
}
