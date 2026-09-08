import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PdfViewer } from './PdfViewer';
import { usePdfStore, useTabsStore } from '../store';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  prepare: vi.fn(),
  attach: vi.fn(),
  zoom: vi.fn(),
  destroy: vi.fn(),
  bind: vi.fn(() => vi.fn()),
}));
vi.mock('../pdf/pdfjs', () => ({ ensurePdfjs: () => ({ getDocument: mocks.load }) }));
vi.mock('../pdf/pages', () => ({
  PdfPages: class {
    prepare = mocks.prepare;
    attach = mocks.attach;
    setZoom = mocks.zoom;
    destroy = mocks.destroy;
    elements = [];
  },
}));
vi.mock('../pdf/zoom', () => ({ bindPreviewZoom: mocks.bind, capturePageAnchor: () => null }));
vi.mock('../hooks/usePdfSearch', () => ({
  usePdfSearch: () => ({ applyHighlights: vi.fn(), findOpen: false }),
}));
let tree: ReactTestRenderer;
let host: EventTarget & {
  replaceChildren: ReturnType<typeof vi.fn>;
  querySelector: ReturnType<typeof vi.fn>;
  scrollTop: number;
  clientHeight: number;
};
let documents: { destroy: ReturnType<typeof vi.fn> }[];
let tasks: { destroy: ReturnType<typeof vi.fn> }[];

beforeEach(() => {
  vi.clearAllMocks();
  documents = [];
  tasks = [];
  mocks.prepare.mockResolvedValue(undefined);
  mocks.load.mockImplementation(() => {
    const loadingTask = { destroy: vi.fn(async () => {}), promise: Promise.resolve({}) };
    const doc = { numPages: 10, loadingTask, destroy: vi.fn(async () => {}) };
    loadingTask.promise = Promise.resolve(doc);
    documents.push(doc);
    tasks.push(loadingTask);
    return loadingTask;
  });
  host = Object.assign(new EventTarget(), {
    replaceChildren: vi.fn(),
    querySelector: vi.fn(),
    scrollTop: 0,
    clientHeight: 600,
  });
  useTabsStore.setState({
    activeTabId: 'one',
    tabs: [
      { id: 'one', title: 'one.tex', lang: 'latex', filePath: null, content: '', isDirty: false },
    ],
  });
  usePdfStore.setState({
    ownerTabId: 'one',
    sourceRoot: null,
    bytes: new Uint8Array([1]),
    zoom: 1,
    currentPage: 1,
    numPages: 0,
    scrollRequest: null,
  });
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
});
const mount = async (element = <PdfViewer />) => {
  await act(async () => {
    tree = create(element, {
      createNodeMock: (element) => (element.type === 'div' && element.props.onScroll ? host : null),
    });
  });
};

it('changes only the existing page zoom without reloading or preparing a PDF again', async () => {
  await mount();
  expect(mocks.attach).toHaveBeenCalledTimes(1);
  act(() => usePdfStore.getState().setZoom(1.4));
  expect(mocks.zoom).toHaveBeenLastCalledWith(1.4, undefined);
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
});

it('cancels a superseded candidate and never attaches its late output', async () => {
  let resolve!: () => void;
  mocks.prepare.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await mount();
  expect(mocks.attach).not.toHaveBeenCalled();
  await act(async () => usePdfStore.getState().setBytes(new Uint8Array([2])));
  expect(tasks[0].destroy).toHaveBeenCalled();
  expect(mocks.attach).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  expect(mocks.attach).toHaveBeenCalledTimes(1);
});

it('tears down a hidden renderer and loads only the latest PDF when reopened', async () => {
  await mount();
  act(() => tree.update(<PdfViewer visible={false} />));
  expect(documents[0].destroy).toHaveBeenCalled();
  act(() => usePdfStore.getState().setBytes(new Uint8Array([3])));
  expect(mocks.load).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(<PdfViewer />));
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(mocks.attach).toHaveBeenCalledTimes(2);
});

it('converts forward SyncTeX PDF points using the displayed scale exactly once', async () => {
  await mount();
  host.querySelector.mockReturnValue({ offsetTop: 1200 });
  act(() => usePdfStore.getState().setZoom(2));
  act(() => usePdfStore.getState().requestScroll(2, 300));
  expect(host.scrollTop).toBe(1600);
});

it('shows synchronous PDF worker initialization errors instead of failing the effect', async () => {
  mocks.load.mockImplementationOnce(() => { throw new Error('worker unavailable'); });
  await mount();
  expect(JSON.stringify(tree.toJSON())).toContain('worker unavailable');
  expect(tree.root.findByProps({ role: 'alert' })).toBeDefined();
  expect(mocks.attach).not.toHaveBeenCalled();
});

it('reports a failed first paint and reloads successfully without remounting the host', async () => {
  mocks.prepare.mockRejectedValueOnce(new Error('canvas failed'));
  await mount();
  expect(JSON.stringify(tree.toJSON())).toContain('canvas failed');
  expect(mocks.attach).not.toHaveBeenCalled();
  const reload = tree.root.findAllByType('button').find(button => button.props.children === 'Reload preview')!;
  await act(async () => reload.props.onClick());
  expect(mocks.attach).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
});
