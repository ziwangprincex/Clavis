import { t } from './index';

/** Localize only app-authored status envelopes, preserving compiler details verbatim. */
export function statusMessage(text: string): string {
  const prefixes: [string, string][] = [
    ['Save failed: ', 'Save failed: {detail}'],
    ['Saved, but local history failed: ', 'Saved, but local history failed: {detail}'],
    ['Could not stop compilation: ', 'Could not stop compilation: {detail}'],
    ['Compile failed: ', 'Compile failed: {detail}'],
    ['Project config: ', 'Project config: {detail}'],
    ['Image not added: ', 'Image not added: {detail}'],
  ];
  for (const [prefix, key] of prefixes) if (text.startsWith(prefix)) return t(key, { detail: text.slice(prefix.length) });
  const rendered = /^Rendered \((\d+) runs?\)$/.exec(text);
  if (rendered) return t('Rendered ({count} runs)', { count: rendered[1] });
  return t(text);
}
