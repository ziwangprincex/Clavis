import { describe, it, expect, beforeEach } from 'vitest';
import { useTabsStore, newTabId, type Tab } from './tabs';

function makeTab(over: Partial<Tab> = {}): Tab {
  return {
    id: newTabId(),
    title: 'x.md',
    filePath: null,
    lang: 'markdown',
    content: '',
    isDirty: false,
    ...over,
  };
}

function reset() {
  useTabsStore.setState({ tabs: [], activeTabId: null });
}

describe('tabs store reducers', () => {
  beforeEach(reset);

  it('addTab appends and makes the new tab active', () => {
    const t1 = makeTab();
    const t2 = makeTab();
    useTabsStore.getState().addTab(t1);
    useTabsStore.getState().addTab(t2);
    const s = useTabsStore.getState();
    expect(s.tabs.map(t => t.id)).toEqual([t1.id, t2.id]);
    expect(s.activeTabId).toBe(t2.id);
  });

  it('patchTab updates only the targeted tab', () => {
    const t1 = makeTab({ content: 'a' });
    const t2 = makeTab({ content: 'b' });
    useTabsStore.getState().addTab(t1);
    useTabsStore.getState().addTab(t2);
    useTabsStore.getState().patchTab(t1.id, { content: 'changed', isDirty: true });
    const tabs = useTabsStore.getState().tabs;
    expect(tabs.find(t => t.id === t1.id)!.content).toBe('changed');
    expect(tabs.find(t => t.id === t1.id)!.isDirty).toBe(true);
    expect(tabs.find(t => t.id === t2.id)!.content).toBe('b');
  });

  it('closeTab of a non-active tab keeps the current active tab', () => {
    const t1 = makeTab();
    const t2 = makeTab();
    const t3 = makeTab();
    const store = useTabsStore.getState();
    store.addTab(t1);
    store.addTab(t2);
    store.addTab(t3);
    store.setActive(t3.id);
    store.closeTab(t1.id); // close a tab that isn't active
    const s = useTabsStore.getState();
    expect(s.tabs.map(t => t.id)).toEqual([t2.id, t3.id]);
    expect(s.activeTabId).toBe(t3.id); // active unchanged
  });

  it('closeTab of the active tab falls back to the last remaining tab', () => {
    const t1 = makeTab();
    const t2 = makeTab();
    const store = useTabsStore.getState();
    store.addTab(t1);
    store.addTab(t2);
    store.setActive(t2.id);
    store.closeTab(t2.id);
    const s = useTabsStore.getState();
    expect(s.tabs.map(t => t.id)).toEqual([t1.id]);
    expect(s.activeTabId).toBe(t1.id);
  });

  it('closeTab clearing the last tab sets activeTabId to null', () => {
    const t1 = makeTab();
    const store = useTabsStore.getState();
    store.addTab(t1);
    store.closeTab(t1.id);
    const s = useTabsStore.getState();
    expect(s.tabs).toEqual([]);
    expect(s.activeTabId).toBeNull();
  });

  it('newTabId produces unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newTabId()));
    expect(ids.size).toBe(50);
  });
});
