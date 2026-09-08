import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { buildCompletionSource } from './source';
import submissionStyles from '../components/SubmissionCheckDialog.module.css?raw';

// CSS Modules localize classes, not bare tag selectors. This dialog used to
// publish `li span { text-transform: uppercase }` into every completion popup.
describe('completion presentation', () => {
  it('keeps submission dialog rules scoped to local classes', () => {
    const selectors = [...submissionStyles.matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .flatMap(match => match[1].split(',').map(selector => selector.trim()));
    expect(selectors.length).toBeGreaterThan(20);
    for (const selector of selectors) {
      expect(selector, `Unscoped dialog rule: ${selector}`).toMatch(/^\.[\w-]+/);
    }
  });

  it.each([
    {
      name: 'mixed-case macro',
      text: '\\newcommand{\\myURL}{example}\n\\my',
      label: '\\myURL',
      file: null,
    },
    {
      name: 'uppercase macro',
      text: '\\newcommand{\\URL}{example}\n\\UR',
      label: '\\URL',
      file: null,
    },
    {
      name: 'reference key',
      text: '\\label{sec:Introduction}\n\\ref{sec:',
      label: 'sec:Introduction',
      file: null,
    },
    {
      name: 'citation key',
      text: '\\cite{Knuth',
      label: 'Knuth1984',
      file: { path: '/paper/Refs.bib', language: 'latex' as const, text: '@book{Knuth1984, title={The TeXbook}}' },
    },
    {
      name: 'file path',
      text: '\\input{Chapters/',
      label: 'Chapters/Intro',
      file: { path: '/paper/Chapters/Intro.tex', language: 'latex' as const, text: 'Introduction' },
    },
  ])('preserves displayed and inserted casing for $name', async ({ text, label, file }) => {
    const state = EditorState.create({ doc: text });
    const source = buildCompletionSource('latex', () => ({
      rootPath: '/paper/main.tex',
      activePath: '/paper/main.tex',
      documents: file ? [file] : [],
    }));
    const result = await source(new CompletionContext(state, text.length, true));
    const option = result?.options.find(candidate => candidate.label === label);
    expect(option).toBeDefined();
    expect(option?.apply).toBe(label);
  });
});
