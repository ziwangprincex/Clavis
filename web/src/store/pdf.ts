// PDF store — viewer state for the PDF preview panel.
// The actual PDFDocumentProxy lives outside the store (pdfjs handles its own
// lifecycle); we only track UI-level state here.

import { create } from 'zustand';

interface PdfStore {
  /** Current PDF bytes (base64-decoded). null when nothing is loaded. */
  bytes: Uint8Array | null;
  numPages: number;
  currentPage: number;
  zoom: number;
  /** Latest workdir token for SyncTeX lookups. */
  workdirToken: string | null;
  /**
   * Pending "scroll the viewer here" request (e.g. forward SyncTeX).
   * `y` is in PDF points from the top of the page, or null for page top.
   * `seq` makes repeated jumps to the same spot re-trigger the effect.
   */
  scrollRequest: { page: number; y: number | null; seq: number } | null;

  setBytes: (b: Uint8Array | null) => void;
  setNumPages: (n: number) => void;
  setCurrentPage: (n: number) => void;
  setZoom: (z: number) => void;
  setWorkdirToken: (t: string | null) => void;
  requestScroll: (page: number, y?: number | null) => void;
}

export const usePdfStore = create<PdfStore>(set => ({
  bytes: null,
  numPages: 0,
  currentPage: 1,
  zoom: 1,
  workdirToken: null,
  scrollRequest: null,

  setBytes: bytes => set({ bytes }),
  setNumPages: n => set({ numPages: n }),
  setCurrentPage: n => set({ currentPage: n }),
  setZoom: z => set({ zoom: z }),
  setWorkdirToken: t => set({ workdirToken: t }),
  requestScroll: (page, y = null) =>
    set(s => ({ scrollRequest: { page, y, seq: (s.scrollRequest?.seq ?? 0) + 1 } })),
}));
