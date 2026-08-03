import { describe, expect, it } from 'vitest';
import { buildEditorKeymap } from './keymaps';

describe('editor keymap composition', () => {
  it('does not duplicate the completion keymap installed by autocompletion()', () => {
    const plainEnterBindings = buildEditorKeymap().filter(binding => binding.key === 'Enter');

    expect(plainEnterBindings).toHaveLength(1);
  });
});
