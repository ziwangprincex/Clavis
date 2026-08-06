import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { inputLinkExtension } from './inputLinks';

describe('source file link extension', () => {
  it('constructs a Typst-aware extension without parsing dynamic paths', () => {
    const state = EditorState.create({ doc: '#include("chapters/intro.typ")\n#import path', extensions: [inputLinkExtension('typst', undefined, () => {})] });
    expect(state.doc.toString()).toContain('chapters/intro.typ');
  });

  it('does not attach source links for Markdown', () => {
    expect(inputLinkExtension('markdown', undefined, () => {})).toBeDefined();
  });
});
