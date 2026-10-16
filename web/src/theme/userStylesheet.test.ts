// A minimal stand-in for the document: only what the injection touches. No
// jsdom dependency for a few lines of DOM work.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const css = vi.fn(async () => '');
vi.mock('../api/tauri', () => ({ ipc: { readUserStylesheet: () => css() } }));

const children: { id?: string; textContent?: string; remove?: () => void }[] = [];
const fakeDocument = {
  head: { append: (node: object) => children.push(node), lastElementChild: () => children[children.length - 1] },
  createElement: () => ({ id: '', textContent: '', remove() { children.splice(children.indexOf(this), 1); } }),
  getElementById: (id: string) => children.find(node => node.id === id) ?? null,
};

const { applyUserStylesheet, loadUserStylesheet } = await import('./userStylesheet');

function installed() {
  const node = fakeDocument.getElementById('clavis-user-stylesheet');
  return node ? node.textContent : null;
}

beforeEach(() => {
  children.length = 0;
  css.mockResolvedValue('');
  vi.stubGlobal('document', fakeDocument);
});
afterEach(() => vi.unstubAllGlobals());

describe('user stylesheet', () => {
  it('injects the file into the page once', () => {
    applyUserStylesheet(':root { --accent: #7c9c74 }');
    expect(installed()).toContain('--accent');
    expect(fakeDocument.head.lastElementChild()).toBe(fakeDocument.getElementById('clavis-user-stylesheet'));
    // A second apply reuses the element rather than adding another.
    applyUserStylesheet('--bg: #101010');
    expect(children.filter(node => node.id === 'clavis-user-stylesheet')).toHaveLength(1);
    expect(installed()).toBe('--bg: #101010');
  });

  it('removes the element when the stylesheet becomes empty', () => {
    applyUserStylesheet('--bg: #101010');
    applyUserStylesheet('   ');
    expect(children.filter(node => node.id === 'clavis-user-stylesheet')).toHaveLength(0);
  });

  it('reads the file on load', async () => {
    css.mockResolvedValue('--text: #eee');
    expect(await loadUserStylesheet()).toBe('--text: #eee');
    expect(installed()).toBe('--text: #eee');
  });
});
