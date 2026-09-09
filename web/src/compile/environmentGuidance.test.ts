import { expect, it } from 'vitest';
import { guidance } from './guidance';

it.each([
  'pdflatex not found in PATH', 'xelatex not found in PATH', 'lualatex not found in PATH',
  'custom path for pdflatex not found: /custom/tex',
])('routes the real engine error to environment setup: %s', message => {
  expect(guidance('latex', message).action).toBe('environment');
});
it('keeps missing source files separate from engine installation', () => {
  expect(guidance('latex', "File `chapter.tex' not found").action).toBe('source');
});
