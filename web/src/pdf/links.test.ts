import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { isLink, resolveLink } from './links';

const doc = {
  getDestination: vi.fn(async (name: string) =>
    name === 'cite.reed2000' ? [{ num: 42, gen: 0 }, { name: 'XYZ' }, 72, 700, null] : null),
  getPageIndex: vi.fn(async () => 82),
  getPage: vi.fn(async () => ({
    getViewport: () => ({ convertToViewportPoint: (_x: number, y: number) => [0, 842 - y] }),
  })),
} as unknown as PDFDocumentProxy;

describe('pdf links', () => {
  it('recognises hyperref link annotations only', () => {
    expect(isLink({ subtype: 'Link', rect: [0, 0, 1, 1], dest: 'cite.x' })).toBe(true);
    expect(isLink({ subtype: 'Link', rect: [0, 0, 1, 1], url: 'https://a.b' })).toBe(true);
    expect(isLink({ subtype: 'Link', rect: [0, 0, 1, 1] })).toBe(false);
    expect(isLink({ subtype: 'Widget', rect: [0, 0, 1, 1], dest: 'x' })).toBe(false);
  });

  it('resolves a named destination to a page and y from the top', async () => {
    const target = await resolveLink(doc, { subtype: 'Link', rect: [0, 0, 1, 1], dest: 'cite.reed2000' });
    expect(target).toEqual({ kind: 'page', page: 83, y: 142 });
  });

  it('falls back to the page top for destinations without coordinates', async () => {
    const target = await resolveLink(doc, {
      subtype: 'Link', rect: [0, 0, 1, 1], dest: [{ num: 1, gen: 0 }, { name: 'Fit' }],
    });
    expect(target).toEqual({ kind: 'page', page: 83, y: null });
  });

  it('passes external URLs through and ignores unknown names', async () => {
    expect(await resolveLink(doc, { subtype: 'Link', rect: [0, 0, 1, 1], url: 'https://doi.org/x' }))
      .toEqual({ kind: 'url', url: 'https://doi.org/x' });
    expect(await resolveLink(doc, { subtype: 'Link', rect: [0, 0, 1, 1], dest: 'missing' })).toBeNull();
  });
});
