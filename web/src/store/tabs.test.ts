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

  it('closeTab of the rightmost active tab falls back to its left neighbor', () => {
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


it('closing a middle chapter activates the next chapter instead of the last tab', () => {
  reset();
  const tabs = ['intro', 'methods', 'results', 'appendix'].map(id => makeTab({ id }));
  useTabsStore.getState().setTabs(tabs);
  useTabsStore.getState().setActive('methods');
  useTabsStore.getState().closeTab('methods');
  expect(useTabsStore.getState().activeTabId).toBe('results');
  expect(useTabsStore.getState().tabs.map(t => t.id)).toEqual(['intro', 'results', 'appendix']);
});

it('closing the first chapter activates its immediate neighbor', () => {
  reset();
  useTabsStore.getState().setTabs(['intro', 'methods', 'results'].map(id => makeTab({ id })));
  useTabsStore.getState().setActive('intro');
  useTabsStore.getState().closeTab('intro');
  expect(useTabsStore.getState().activeTabId).toBe('methods');
});
