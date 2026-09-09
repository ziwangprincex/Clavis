import type { PDFDocumentProxy } from 'pdfjs-dist';

/** A resolved PDF link: an in-document jump (page + y points from the top) or an external URL. */
export type PdfLinkTarget =
  | { kind: 'page'; page: number; y: number | null }
  | { kind: 'url'; url: string };

/** Subset of a pdf.js Link annotation that we act on. */
export interface LinkAnnotation {
  subtype?: string;
  rect?: number[];
  url?: string;
  dest?: string | unknown[] | null;
}

export function isLink(annotation: LinkAnnotation): boolean {
  return annotation.subtype === 'Link' && Array.isArray(annotation.rect)
    && (typeof annotation.url === 'string' || annotation.dest != null);
}

// hyperref writes named destinations (`cite.key`, `section.1`) whose explicit
// form is `[pageRef, {name: 'XYZ'}, left, top, zoom]`. Convert `top` from PDF
// user space to points from the top edge so the viewer can reuse SyncTeX jumps.
export async function resolveLink(
  doc: PDFDocumentProxy,
  annotation: LinkAnnotation,
): Promise<PdfLinkTarget | null> {
  if (typeof annotation.url === 'string') return { kind: 'url', url: annotation.url };
  const dest = annotation.dest;
  if (dest == null) return null;
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length === 0) return null;
  const [ref, mode] = explicit as [unknown, { name?: string } | undefined];
  const index = typeof ref === 'number'
    ? ref
    : await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
  const page = index + 1;
  const top = mode?.name === 'XYZ' ? explicit[3] : mode?.name === 'FitH' || mode?.name === 'FitBH' ? explicit[2] : null;
  if (typeof top !== 'number') return { kind: 'page', page, y: null };
  const viewport = (await doc.getPage(page)).getViewport({ scale: 1 });
  const [, y] = viewport.convertToViewportPoint(0, top);
  return { kind: 'page', page, y: Math.max(0, y) };
}
