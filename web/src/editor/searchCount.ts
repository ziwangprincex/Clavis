import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { getSearchQuery, searchPanelOpen, type SearchQuery } from '@codemirror/search';
import { t } from '../i18n';

/** Matches counted before the count reads "1000+ matches". */
const LIMIT = 1000;

/**
 * "2 of 5" beside the search panel's buttons, as browsers and Typora show it.
 * CodeMirror's own panel has no count, so after typing a query nothing said
 * whether it matched. Counting runs only while the panel is open, and again
 * only when the document or the query changes.
 */
export const searchCount = ViewPlugin.fromClass(class {
  private query: SearchQuery | null = null;
  private matches: { from: number; to: number }[] = [];
  private more = false;
  private dom: HTMLElement | null = null;

  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    if (!searchPanelOpen(update.state)) {
      this.query = null;
      return;
    }
    const query = getSearchQuery(update.state);
    if (update.docChanged || !this.query || !query.eq(this.query)) this.collect(query);
    // The panel is drawn in the same update; write once it is in the DOM.
    this.view.requestMeasure({ read: () => null, write: () => this.render() });
  }

  private collect(query: SearchQuery) {
    this.query = query;
    this.matches = [];
    this.more = false;
    if (!query.valid) return;
    const cursor = query.getCursor(this.view.state);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      if (this.matches.length === LIMIT) { this.more = true; break; }
      this.matches.push(next.value);
    }
  }

  private render() {
    const panel = this.view.dom.querySelector('.cm-search');
    if (!panel || !searchPanelOpen(this.view.state)) return;
    if (!this.dom || !panel.contains(this.dom)) {
      this.dom = document.createElement('span');
      this.dom.className = 'cm-search-count';
      this.dom.setAttribute('aria-live', 'polite');
      const anchor = panel.querySelector('button[name=select]');
      if (anchor) anchor.after(this.dom); else panel.append(this.dom);
    }
    this.dom.textContent = this.text();
  }

  private text(): string {
    if (!this.query?.valid) return '';
    if (!this.matches.length) return t('No matches');
    const total = this.more ? `${LIMIT}+` : String(this.matches.length);
    const { from, to } = this.view.state.selection.main;
    const current = this.matches.findIndex(match => match.from === from && match.to === to);
    if (current >= 0) return t('{current} of {total}', { current: current + 1, total });
    return total === '1' ? t('1 match') : t('{count} matches', { count: total });
  }

  destroy() {
    this.dom?.remove();
  }
});
