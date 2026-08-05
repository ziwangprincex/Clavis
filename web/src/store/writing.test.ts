import { describe, expect, it } from 'vitest';
import { useWritingStore } from './writing';

describe('writing diagnostics store', () => {
  it('caps diagnostics to keep the sidebar bounded', () => {
    const tabs = [{ id: 'a', title: 'a.md', filePath: 'a.md', lang: 'markdown' as const, isDirty: false, content: Array(700).fill('50 %').join('\n') }];
    useWritingStore.getState().refresh(tabs);
    expect(useWritingStore.getState().diagnostics).toHaveLength(500);
  });
});
