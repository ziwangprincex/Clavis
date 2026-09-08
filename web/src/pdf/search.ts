import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface PdfTextPage {
  page: number;
  text: string;
  items: { from: number; to: number; y: number }[];
}
export interface PdfMatch {
  page: number;
  from: number;
  y: number;
  parts: { item: number; from: number; to: number }[];
}

/** Text is cached for this PDF only; no canvas or offscreen TextLayer is needed. */
export class PdfTextIndex {
  private pages = new Map<number, Promise<PdfTextPage>>();
  constructor(private doc: PDFDocumentProxy) {}

  private read(pageNumber: number): Promise<PdfTextPage> {
    let pending = this.pages.get(pageNumber);
    if (!pending) {
      pending = this.extract(pageNumber).catch(error => {
        this.pages.delete(pageNumber);
        throw new Error(`Could not search PDF page ${pageNumber}: ${String(error)}`);
      });
      this.pages.set(pageNumber, pending);
    }
    return pending;
  }

  private async extract(pageNumber: number): Promise<PdfTextPage> {
    const page = await this.doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const items: PdfTextPage['items'] = [];
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const from = text.length;
      text += item.str.replace(/\s/g, ' ');
      const [, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      items.push({ from, to: text.length, y: y / viewport.height });
      if (item.hasEOL && !/\s$/.test(text)) text += ' ';
    }
    return { page: pageNumber, text, items };
  }

  async load(cancelled: () => boolean): Promise<PdfTextPage[] | null> {
    const pages: PdfTextPage[] = [];
    for (let page = 1; page <= this.doc.numPages; page++) {
      if (cancelled()) return null;
      pages.push(await this.read(page));
      // Cached pages also yield so typing/closing find can cancel a long scan.
      if (page % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return cancelled() ? null : pages;
  }
}

export function findPdfMatches(pages: PdfTextPage[], query: string, matchCase: boolean): PdfMatch[] {
  if (!query.trim()) return [];
  const needle = new RegExp(query.replace(/\s/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
  return pages.flatMap(page => {
    const matches: PdfMatch[] = [];
    needle.lastIndex = 0;
    let firstItem = 0;
    for (let hit = needle.exec(page.text); hit; hit = needle.exec(page.text)) {
      const end = hit.index + hit[0].length;
      while (firstItem < page.items.length && page.items[firstItem].to <= hit.index) firstItem++;
      const parts: PdfMatch['parts'] = [];
      for (let index = firstItem; index < page.items.length && page.items[index].from < end; index++) {
        const item = page.items[index];
        if (item.to > item.from) parts.push({ item: index, from: Math.max(0, hit.index - item.from), to: Math.min(item.to, end) - item.from });
      }
      if (parts.length) matches.push({ page: page.page, from: hit.index, y: page.items[parts[0].item].y, parts });
    }
    return matches;
  });
}
