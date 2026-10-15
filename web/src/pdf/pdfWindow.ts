// The PDF in a window of its own, which can sit on another display, as
// Texifier's external-display viewer does. The main window stays in charge of
// compiling and SyncTeX: it sends the PDF and scroll requests to the PDF
// window, which sends back the place a reader clicks.

import { useEffect } from 'react';
import { emit, hasTauri, ipc, listen } from '../api/tauri';
import { usePdfStore } from '../store';
import { base64 } from '../render/markdownView';

const READY = 'pdf-window-ready';
const CLOSED = 'pdf-window-closed';
const DOCUMENT = 'pdf-window-document';
const SCROLL = 'pdf-window-scroll';
const SYNCTEX = 'pdf-window-synctex';

/** The query a PDF window is opened with. */
export const isPdfWindow = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('window') === 'pdf';

export const openPdfWindow = () => ipc.openPdfWindow();

/** Main window: keep an open PDF window supplied, and act on its clicks. */
export function usePdfWindowFeed(onSyncTex: (page: number, x: number, y: number) => void): void {
  useEffect(() => {
    if (!hasTauri() || isPdfWindow()) return;
    let open = false;
    let sent: Uint8Array | null = null;
    const send = (force = false) => {
      const { bytes } = usePdfStore.getState();
      if (!open || (!force && bytes === sent)) return;
      sent = bytes;
      void emit(DOCUMENT, { data: bytes ? base64(bytes) : null });
    };
    const offs = [
      listen(READY, () => { open = true; send(true); }),
      listen(CLOSED, () => { open = false; sent = null; }),
      listen<{ page: number; x: number; y: number }>(SYNCTEX, ({ page, x, y }) => onSyncTex(page, x, y)),
    ];
    const unsubscribe = usePdfStore.subscribe((state, previous) => {
      if (state.bytes !== previous.bytes) send();
      if (open && state.scrollRequest && state.scrollRequest !== previous.scrollRequest) {
        void emit(SCROLL, { page: state.scrollRequest.page, y: state.scrollRequest.y });
      }
    });
    return () => {
      unsubscribe();
      for (const off of offs) void off.then(stop => stop());
    };
    // The handler reads only stores and stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** PDF window: show what the main window sends. */
export function usePdfWindowFollow(): void {
  useEffect(() => {
    if (!hasTauri()) return;
    const offs = [
      listen<{ data: string | null }>(DOCUMENT, ({ data }) => {
        usePdfStore.setState({ bytes: data ? Uint8Array.from(atob(data), ch => ch.charCodeAt(0)) : null, stale: false });
      }),
      listen<{ page: number; y: number | null }>(SCROLL, ({ page, y }) => usePdfStore.getState().requestScroll(page, y)),
    ];
    void Promise.all(offs).then(() => emit(READY));
    const closing = () => { void emit(CLOSED); };
    window.addEventListener('beforeunload', closing);
    return () => {
      window.removeEventListener('beforeunload', closing);
      for (const off of offs) void off.then(stop => stop());
    };
  }, []);
}

/** PDF window: a click's place, for the main window's SyncTeX. */
export const sendSyncTex = (page: number, x: number, y: number) => void emit(SYNCTEX, { page, x, y });
