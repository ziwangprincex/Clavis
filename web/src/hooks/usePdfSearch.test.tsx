import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { usePdfSearch, type PdfSearch } from './usePdfSearch';

class Node {
  children: Node[] = [];
  parentElement: Node | null = null;
  dataset: Record<string, string> = {};
  className = '';
  classList = { add: vi.fn(), toggle: vi.fn() };
  private value = '';
  constructor(public fragment = false) {}
  get textContent(): string { return this.value + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.value = value; this.children = []; }
  appendChild(child: Node) {
    if (child.fragment) for (const item of child.children) this.appendChild(item);
    else { this.children.push(child); child.parentElement = this; }
  }
  replaceChildren(child: Node) { this.value = ''; this.children = []; this.appendChild(child); }
}
const marked: Node[] = [];
const layer = (page: number, items = ['needle']) => {
  const spans = items.map((value, index) => {
    const text = new Node(); text.textContent = value; text.dataset.textIndex = String(index); return text;
  });
  return { spans, querySelectorAll: () => spans, closest: () => ({ dataset: { page: String(page) } }) };
};
function makeDoc(items: string[][] = [['needle'], ['needle'], ['needle']]) {
  return { numPages: items.length, getPage: vi.fn(async (n: number) => ({
    getTextContent: async () => ({ items: items[n - 1].map(str => ({ str, transform: [1,0,0,1,0,700], hasEOL: false })) }),
    getViewport: () => ({ height: 800, convertToViewportPoint: () => [0, 100] }),
  })) } as unknown as PDFDocumentProxy;
}
let tree: ReactTestRenderer;
let search: PdfSearch;
let layers: ReturnType<typeof layer>[];
let host: { scrollTop: number; clientHeight: number; querySelectorAll: () => typeof layers; querySelector: (s: string) => object };
let scroll: { current: HTMLDivElement };
let doc: PDFDocumentProxy;
function Harness({ source = doc }: { source?: PDFDocumentProxy | null }) {
  search = usePdfSearch(scroll, source);
  return null;
}
const find = async (query = 'needle') => {
  await act(async () => { search.openFinder(); search.setFindQuery(query); });
};
beforeEach(() => {
  layers = [layer(1)]; marked.length = 0; doc = makeDoc();
  host = {
    scrollTop: 0, clientHeight: 600, querySelectorAll: () => layers,
    querySelector: selector => ({ offsetTop: (Number(selector.match(/\d+/)?.[0]) - 1) * 1000, clientHeight: 800 }),
  };
  scroll = { current: host as unknown as HTMLDivElement };
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 1; });
  vi.stubGlobal('document', {
    createDocumentFragment: () => new Node(true),
    createTextNode: (text: string) => { const node = new Node(); node.textContent = text; return node; },
    createElement: () => { const node = new Node(); marked.push(node); return node; },
  });
  act(() => { tree = create(<Harness />); });
});
afterEach(() => { act(() => tree.unmount()); vi.unstubAllGlobals(); });

it('counts all pages before they mount, navigates to a remote result and paints it when it appears', async () => {
  await find();
  expect(search.findCount).toBe(3);
  expect(marked).toHaveLength(1);
  act(() => search.gotoMatch(2));
  expect(search.findIndex).toBe(2);
  expect(host.scrollTop).toBe(1900);
  layers = [layer(3)]; marked.length = 0;
  act(() => search.applyHighlights());
  expect(search.findCount).toBe(3);
  expect(search.findIndex).toBe(2);
  expect(marked[0].classList.add).toHaveBeenCalled();
  expect(host.scrollTop).toBe(1900);
});
it('restores the selected match after zoom repaint without navigation or recounting', async () => {
  await find();
  act(() => search.gotoMatch(1));
  host.scrollTop = 1450;
  layers = [layer(1), layer(2)]; marked.length = 0;
  act(() => search.applyHighlights());
  expect(search.findIndex).toBe(1);
  expect(search.findCount).toBe(3);
  expect(host.scrollTop).toBe(1450);
  expect(marked[1].classList.add).toHaveBeenCalled();
  act(() => search.applyHighlights());
  expect(layers[1].spans[0].textContent).toBe('needle');
});
it('highlights a single occurrence across separate text runs', async () => {
  doc = makeDoc([['nee', 'dle']]); layers = [layer(1, ['nee', 'dle'])];
  act(() => tree.update(<Harness source={doc} />));
  await find();
  expect(search.findCount).toBe(1);
  expect(marked.map(node => node.textContent)).toEqual(['nee', 'dle']);
});
it('clears highlights and cannot navigate after closing find', async () => {
  await find();
  act(() => search.closeFinder());
  marked.length = 0;
  act(() => { search.applyHighlights(); search.gotoMatch(1); });
  expect(search.findCount).toBe(0);
  expect(search.findIndex).toBe(-1);
  expect(marked).toHaveLength(0);
  expect(layers[0].spans[0].textContent).toBe('needle');
});
it('keeps selection and scroll when the same document is recompiled', async () => {
  await find(); act(() => search.gotoMatch(1)); host.scrollTop = 1450;
  await act(async () => tree.update(<Harness source={makeDoc()} />));
  expect(search.findIndex).toBe(1);
  expect(host.scrollTop).toBe(1450);
});
it('ignores extraction that finishes after closing or replacing a document', async () => {
  let finish!: (page: unknown) => void;
  const slow = { numPages: 3, getPage: vi.fn(() => new Promise(resolve => { finish = resolve; })) } as unknown as PDFDocumentProxy;
  act(() => tree.update(<Harness source={slow} />));
  await find(); expect(search.searching).toBe(true);
  await act(async () => tree.update(<Harness source={makeDoc([['unrelated']])} />));
  expect(search.findCount).toBe(0);
  await act(async () => finish(await makeDoc().getPage(1)));
  expect(search.findCount).toBe(0);
  expect(slow.getPage).toHaveBeenCalledTimes(1);
  act(() => tree.update(<Harness source={slow} />));
  act(() => search.closeFinder());
  await act(async () => finish(await makeDoc().getPage(1)));
  expect(search.findCount).toBe(0);
});
it('displays index failure instead of reporting a false zero result', async () => {
  const broken = { numPages: 1, getPage: vi.fn(async () => { throw new Error('unreadable'); }) } as unknown as PDFDocumentProxy;
  act(() => tree.update(<Harness source={broken} />));
  await find();
  expect(search.searchError).toContain('page 1');
  expect(search.searching).toBe(false);
  expect(search.findCount).toBe(0);
});
it('query changes use the cached text and reset the selection', async () => {
  await find(); act(() => search.gotoMatch(2));
  await act(async () => search.setFindCase(true));
  expect(search.findIndex).toBe(0);
  expect(doc.getPage).toHaveBeenCalledTimes(3);
});

it("locates the first result when a query was entered before PDF loading completed", async () => {
  act(() => tree.update(<Harness source={null} />));
  await find();
  expect(search.findCount).toBe(0);
  await act(async () => tree.update(<Harness source={makeDoc([["body"], ["needle"]])} />));
  expect(search.findCount).toBe(1);
  expect(host.scrollTop).toBe(900);
});
it("does not extract document text before the user searches", () => {
  expect(doc.getPage).not.toHaveBeenCalled();
});
