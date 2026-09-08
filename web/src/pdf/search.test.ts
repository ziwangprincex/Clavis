import { expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfTextIndex, findPdfMatches } from './search';

const textItem = (str: string, hasEOL = false) => ({ str, hasEOL, transform: [1, 0, 0, 1, 0, 700] });
function documentWith(count: number, items: (page: number) => object[]) {
  const render = vi.fn();
  const text = vi.fn(async (page: number) => ({ items: items(page) }));
  const getPage = vi.fn(async (page: number) => ({
    getTextContent: () => text(page), render,
    getViewport: () => ({ height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800 - y] }),
  }));
  return { doc: { numPages: count, getPage } as unknown as PDFDocumentProxy, getPage, render, text };
}

it('searches all 300 pages, caching text without creating any canvas', async () => {
  const { doc, getPage, render } = documentWith(300, page => [textItem(page === 299 ? 'remote needle' : 'body')]);
  const index = new PdfTextIndex(doc);
  const pages = (await index.load(() => false))!;
  expect(findPdfMatches(pages, 'needle', false)).toEqual([
    { page: 299, from: 7, y: 0.125, parts: [{ item: 0, from: 7, to: 13 }] },
  ]);
  await index.load(() => false);
  expect(getPage).toHaveBeenCalledTimes(300);
  expect(render).not.toHaveBeenCalled();
});
it('matches across text items and line breaks with accurate local ranges', async () => {
  const { doc } = documentWith(1, () => [
    { type: 'beginMarkedContent' }, textItem('nee'), textItem(''), textItem('dle', true), textItem('next'),
  ]);
  const pages = (await new PdfTextIndex(doc).load(() => false))!;
  expect(findPdfMatches(pages, 'needle next', false)[0].parts).toEqual([
    { item: 0, from: 0, to: 3 }, { item: 2, from: 0, to: 3 }, { item: 3, from: 0, to: 4 },
  ]);
});
it('treats queries literally, preserves offsets and honors match case', async () => {
  const { doc } = documentWith(1, () => [textItem('İ Needle needle [a+b]')]);
  const pages = (await new PdfTextIndex(doc).load(() => false))!;
  expect(findPdfMatches(pages, 'needle', false).map(hit => hit.from)).toEqual([2, 9]);
  expect(findPdfMatches(pages, 'needle', true).map(hit => hit.from)).toEqual([9]);
  expect(findPdfMatches(pages, '[a+b]', false)).toHaveLength(1);
  expect(findPdfMatches(pages, '  ', false)).toEqual([]);
});
it('stops fetching subsequent pages when the search is cancelled', async () => {
  let cancelled = false;
  const { doc, getPage } = documentWith(300, () => {
    cancelled = true;
    return [textItem('needle')];
  });
  expect(await new PdfTextIndex(doc).load(() => cancelled)).toBeNull();
  expect(getPage).toHaveBeenCalledTimes(1);
});
it('reports extraction errors instead of returning a misleading partial count and permits retry', async () => {
  const { doc, text } = documentWith(2, () => [textItem('needle')]);
  text.mockRejectedValueOnce(new Error('unavailable'));
  const index = new PdfTextIndex(doc);
  await expect(index.load(() => false)).rejects.toThrow('page 1');
  expect(findPdfMatches((await index.load(() => false))!, 'needle', false)).toHaveLength(2);
});
