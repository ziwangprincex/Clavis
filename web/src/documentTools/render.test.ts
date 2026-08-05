import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRenderableDocument } from './render';

beforeEach(() => vi.restoreAllMocks());

describe('document render eligibility', () => {
  it('accepts qmd and md but not unsaved or unrelated files', () => {
    const base = { id: 'x', title: 'x', lang: 'markdown' as const, content: '', isDirty: false };
    expect(isRenderableDocument({ ...base, filePath: 'C:/paper/paper.qmd' })).toBe(true);
    expect(isRenderableDocument({ ...base, filePath: 'C:/paper/notes.md' })).toBe(true);
    expect(isRenderableDocument({ ...base, filePath: 'C:/paper/main.typ' })).toBe(false);
    expect(isRenderableDocument({ ...base, filePath: null })).toBe(false);
  });
});
