// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { openSearchPanel, search, SearchQuery, setSearchQuery } from '@codemirror/search';
import { searchCount } from './searchCount';
import { defaultSettings, useSettingsStore } from '../store/settings';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; useSettingsStore.setState({ settings: defaultSettings }); });

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const count = () => view!.dom.querySelector('.cm-search-count');

describe('search match count', () => {
  // Regression: CodeMirror's panel said nothing about how many matches there were.
  it('counts the matches and says which one is current', async () => {
    useSettingsStore.setState({ settings: { ...defaultSettings, ui_language: 'en' } });
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: 'design one, design two, design three', extensions: [search(), searchCount] }),
    });
    openSearchPanel(view);
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'design' })) });
    await frame();
    expect(count()?.textContent).toBe('3 matches');
    expect(count()?.getAttribute('aria-live')).toBe('polite');
    // What findNext does, minus the scroll jsdom cannot measure: select the first match.
    view.dispatch({ selection: { anchor: 0, head: 6 } });
    await frame();
    expect(count()?.textContent).toBe('1 of 3');
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'nowhere' })) });
    await frame();
    expect(count()?.textContent).toBe('No matches');
  });

  it('shows nothing for an empty query', async () => {
    view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'text', extensions: [search(), searchCount] }) });
    openSearchPanel(view);
    await frame();
    expect(count()?.textContent ?? '').toBe('');
  });
});
