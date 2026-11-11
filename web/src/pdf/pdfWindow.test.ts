import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { usePdfStore } from '../store';

const handlers = new Map<string, ((payload: unknown) => void)[]>();
const emitted: [string, unknown][] = [];
// The backend's PDF mailbox between the windows.
const mailbox = vi.hoisted(() => ({ bytes: null as Uint8Array | null }));
const { sharePdf, sharedPdf } = vi.hoisted(() => ({
  sharePdf: vi.fn(async (bytes: Uint8Array | null) => { mailbox.bytes = bytes; }),
  sharedPdf: vi.fn(async () => mailbox.bytes),
}));
vi.mock('../api/tauri', () => ({
  hasTauri: () => true,
  ipc: { openPdfWindow: vi.fn(), sharePdf, sharedPdf },
  listen: async (event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, [...handlers.get(event) ?? [], handler]);
    return () => handlers.set(event, (handlers.get(event) ?? []).filter(h => h !== handler));
  },
  emit: async (event: string, payload?: unknown) => { emitted.push([event, payload]); },
}));

const { usePdfWindowFeed, usePdfWindowFollow, sendSyncTex } = await import('./pdfWindow');
const fire = (event: string, payload?: unknown) => { for (const handler of handlers.get(event) ?? []) handler(payload); };

function mount(hook: () => void) {
  const Probe = () => { hook(); return null; };
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(createElement(Probe)); });
  return tree;
}

beforeEach(() => {
  handlers.clear();
  emitted.length = 0;
  mailbox.bytes = null;
  vi.clearAllMocks();
  usePdfStore.setState({ bytes: null, scrollRequest: null });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { search: '' } }));
});
afterEach(() => vi.unstubAllGlobals());

describe('PDF window', () => {
  it('main window: sends the PDF once the window is ready, then only changes, and acts on its clicks', async () => {
    const synctex = vi.fn();
    const tree = mount(() => usePdfWindowFeed(synctex));
    await act(async () => {});
    usePdfStore.setState({ bytes: new Uint8Array([1, 2, 3]) });
    expect(emitted).toEqual([]);
    fire('pdf-window-ready');
    await vi.waitFor(() => expect(emitted).toEqual([['pdf-window-document', undefined]]));
    expect(sharePdf).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    usePdfStore.getState().requestScroll(4, 120);
    expect(emitted.at(-1)).toEqual(['pdf-window-scroll', { page: 4, y: 120 }]);
    fire('pdf-window-synctex', { page: 2, x: 10, y: 20 });
    expect(synctex).toHaveBeenCalledWith(2, 10, 20);
    fire('pdf-window-closed');
    emitted.length = 0;
    usePdfStore.setState({ bytes: new Uint8Array([9]) });
    await act(async () => {});
    expect(emitted).toEqual([]);
    expect(sharePdf).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('PDF window: shows what it is sent and reports clicks', async () => {
    const tree = mount(() => usePdfWindowFollow());
    await act(async () => {});
    expect(emitted).toEqual([['pdf-window-ready', undefined]]);
    mailbox.bytes = new Uint8Array([1, 2, 3]);
    fire('pdf-window-document');
    await vi.waitFor(() => expect([...usePdfStore.getState().bytes ?? []]).toEqual([1, 2, 3]));
    fire('pdf-window-scroll', { page: 3, y: null });
    expect(usePdfStore.getState().scrollRequest).toMatchObject({ page: 3, y: null });
    sendSyncTex(1, 2, 3);
    expect(emitted.at(-1)).toEqual(['pdf-window-synctex', { page: 1, x: 2, y: 3 }]);
    act(() => tree.unmount());
  });

  it('PDF window: keeps the newest PDF when an older read answers last', async () => {
    const tree = mount(() => usePdfWindowFollow());
    await act(async () => {});
    let answerOld!: (bytes: Uint8Array) => void;
    sharedPdf.mockImplementationOnce(() => new Promise(resolve => { answerOld = resolve; }));
    fire('pdf-window-document');
    mailbox.bytes = new Uint8Array([2]);
    fire('pdf-window-document');
    await vi.waitFor(() => expect([...usePdfStore.getState().bytes ?? []]).toEqual([2]));
    answerOld(new Uint8Array([1]));
    await act(async () => {});
    expect([...usePdfStore.getState().bytes ?? []]).toEqual([2]);
    act(() => tree.unmount());
  });
});
