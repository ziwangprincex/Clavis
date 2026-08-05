import { describe, expect, it } from 'vitest';
import { useWritingStore } from './writing';

describe('writing diagnostics store', () => {
  it('caps diagnostics to keep the sidebar bounded', () => {
    const tabs = [{ id: 'a', title: 'a.md', filePath: 'a.md', lang: 'markdown' as const, isDirty: false, content: Array(700).fill('50 %').join('\n') }];
    useWritingStore.getState().refresh(tabs);
    expect(useWritingStore.getState().diagnostics).toHaveLength(500);
  });

  it('passes project writing options to the analyzer', () => {
    const tabs = [{ id: 'a', title: 'a.md', filePath: 'a.md', lang: 'markdown' as const, isDirty: false, content: 'Colour and IV rise.' }];
    useWritingStore.getState().refresh(tabs, { spelling: 'us', ignoredAcronyms: ['IV'] });
    const diagnostics = useWritingStore.getState().diagnostics;
    expect(diagnostics.some(item => item.code === 'spelling-variant' && item.message.includes('colour'))).toBe(true);
    expect(diagnostics.some(item => item.code === 'undefined-acronym' && item.message.includes('IV'))).toBe(false);
  });
});
