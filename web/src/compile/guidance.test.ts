import { expect, it } from 'vitest';
import { guidance } from './guidance';
import { translate } from '../i18n';
import fixtures from './bibliographyDiagnostics.json';

it.each(fixtures)('routes the backend diagnostic: $message', ({ message, action, explanation }) => {
  const result = guidance('latex', message);
  expect(result.action).toBe(action);
  expect(result.explanation).toContain(explanation);
  expect(translate('zh-CN', result.explanation)).not.toBe(result.explanation);
});
it.each(['biber', 'bibtex'])('distinguishes missing %s from processor failure', tool => {
  expect(guidance('latex', `${tool} not found in PATH`).action).toBe('environment');
  const failed = guidance('latex', `${tool} exited with code 2`);
  expect(failed.action).toBe('none');
  expect(failed.explanation).not.toContain('before writing');
});
it.each(["I couldn't open style file plain.bst", "File `refs.bib' not found", "File `plain.bst' not found"])(
  'keeps bibliography file failures out of the generic file rule: %s', message => {
    const result = guidance('latex', message);
    expect(result.action).toBe('source');
    expect(result.explanation).toContain('style (.bst)');
  },
);
it('does not promise that another compile fixes duplicate labels', () => {
  expect(guidance('latex', 'Label `sec:intro` multiply defined; rerun').action).toBe('source');
});
