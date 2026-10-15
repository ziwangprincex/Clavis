import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { usePdfStore } from '../store';

const handlers = new Map<string, ((payload: unknown) => void)[]>();
const emitted: [string, unknown][] = [];
vi.mock('../api/tauri', () => ({
  hasTauri: () => true,
  ipc: { openPdfWindow: vi.fn() },
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
    expect(emitted).toEqual([['pdf-window-document', { data: 'AQID' }]]);
    usePdfStore.getState().requestScroll(4, 120);
    expect(emitted.at(-1)).toEqual(['pdf-window-scroll', { page: 4, y: 120 }]);
    fire('pdf-window-synctex', { page: 2, x: 10, y: 20 });
    expect(synctex).toHaveBeenCalledWith(2, 10, 20);
    fire('pdf-window-closed');
    emitted.length = 0;
    usePdfStore.setState({ bytes: new Uint8Array([9]) });
    expect(emitted).toEqual([]);
    act(() => tree.unmount());
  });

  it('PDF window: shows what it is sent and reports clicks', async () => {
    const tree = mount(() => usePdfWindowFollow());
    await act(async () => {});
    expect(emitted).toEqual([['pdf-window-ready', undefined]]);
    fire('pdf-window-document', { data: 'AQID' });
    expect([...usePdfStore.getState().bytes!]).toEqual([1, 2, 3]);
    fire('pdf-window-scroll', { page: 3, y: null });
    expect(usePdfStore.getState().scrollRequest).toMatchObject({ page: 3, y: null });
    sendSyncTex(1, 2, 3);
    expect(emitted.at(-1)).toEqual(['pdf-window-synctex', { page: 1, x: 2, y: 3 }]);
    act(() => tree.unmount());
  });
});
