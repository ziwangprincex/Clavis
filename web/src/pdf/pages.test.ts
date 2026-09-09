import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfPages } from './pages';
import type { LinkAnnotation } from './links';
import styles from '../components/PdfViewer.module.css';

const textRender = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('pdfjs-dist', () => ({
  TextLayer: class {
    render = textRender;
    textDivs = [{ dataset: {} }];
    cancel = vi.fn();
  },
}));

class Element extends EventTarget {
  connected = false;
  get isConnected(): boolean { return this.connected || (this.parent?.isConnected ?? false); }
  style = Object.assign({ width: '', height: '', transform: '', left: '', top: '' }, { setProperty: vi.fn() });
  dataset: Record<string, string> = {};
  className = '';
  children: Element[] = [];
  parent?: Element;
  scrollTop = 0;
  scrollLeft = 0;
  clientHeight = 800;
  clientWidth = 900;
  width = 0;
  height = 0;
  append(...children: Element[]) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children: Element[]) {
    for (const child of this.children) child.parent = undefined;
    this.children = [];
    this.append(...children);
  }
  getContext() {
    return {};
  }
  getBoundingClientRect() {
    const width = parseFloat(this.style.width) || 600;
    const height = parseFloat(this.style.height) || 800;
    const top = this.parent
      ? this.parent.children
          .slice(0, this.parent.children.indexOf(this))
          .reduce((sum, el) => sum + (parseFloat(el.style.height) || 800) + 24, 0) -
        this.parent.scrollTop
      : 0;
    const left = -(this.parent?.scrollLeft ?? 0);
    return {
      top,
      left,
      width,
      height,
      bottom: top + height,
      right: left + width,
    };
  }
}
let observer: {
  fire: (elements: Element[], intersecting: boolean) => void;
  disconnect: ReturnType<typeof vi.fn>;
};
let resolveRender: (() => void) | undefined;
let hold = false;
const render = vi.fn(() => {
  let reject!: (error: Error) => void;
  const promise = hold
    ? new Promise<void>((resolve, fail) => {
        resolveRender = resolve;
        reject = fail;
      })
    : Promise.resolve();
  return { promise, cancel: vi.fn(() => reject?.(new Error('cancelled'))) };
});
const getTextContent = vi.fn(async () => ({ items: [], styles: {} }));
const getAnnotations = vi.fn(async (): Promise<LinkAnnotation[]> => []);
const getPage = vi.fn(async (index: number) => ({
  getViewport: ({ scale }: { scale: number }) => ({
    width: (index % 2 ? 600 : 700) * scale,
    height: 800 * scale,
    convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) =>
      [x1 * scale, (800 - y1) * scale, x2 * scale, (800 - y2) * scale],
    convertToViewportPoint: (x: number, y: number) => [x * scale, (800 - y) * scale],
  }),
  getAnnotations,
  render,
  getTextContent,
}));
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
let pages: PdfPages;
let host: Element;
let painted: ReturnType<typeof vi.fn>;
let failed: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  textRender.mockReset().mockResolvedValue(undefined);
  getTextContent.mockReset().mockResolvedValue({ items: [], styles: {} });
  getAnnotations.mockReset().mockResolvedValue([]);
  hold = false;
  resolveRender = undefined;
  vi.stubGlobal('document', { createElement: () => new Element() });
  vi.stubGlobal('window', { devicePixelRatio: 2 });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect = vi.fn();
      constructor(private callback: (entries: object[]) => void) {
        observer = this;
      }
      observe() {}
      fire(elements: Element[], intersecting: boolean) {
        this.callback(elements.map((target) => ({ target, isIntersecting: intersecting })));
      }
    },
  );
  host = new Element();
  host.connected = true;
  painted = vi.fn();
  failed = vi.fn();
  pages = new PdfPages(
    host as unknown as HTMLDivElement,
    { numPages: 300, getPage } as unknown as PDFDocumentProxy,
    1,
    painted,
    failed,
  );
});
afterEach(() => {
  pages.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PDF zoom rendering', () => {
  it('reuses 300 page wrappers across a zoom burst and rasterizes only nearby pages once settled', async () => {
    await pages.prepare();
    pages.attach(1);
    const wrappers = [...host.children];
    const surfaces = wrappers.slice(0, 2).map((el) => el.children[0]);
    observer.fire(wrappers.slice(0, 2), true);
    render.mockClear();
    getPage.mockClear();
    for (let n = 1; n <= 30; n++) {
      pages.setZoom(1 + n / 100, { x: 300, y: 400 });
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(host.children).toEqual(wrappers);
    expect(wrappers[0].children[0]).toBe(surfaces[0]);
    expect(surfaces[0].style.transform).toBe('scale(1.3)');
    expect(wrappers[0].style.width).toBe('780px');
    expect(render).not.toHaveBeenCalled();
    expect(getPage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(140);
    expect(render).toHaveBeenCalledTimes(2);
    expect(wrappers[0].children[0]).not.toBe(surfaces[0]);
    expect(wrappers[0].children[0].style.width).toBe('780px');
    expect(wrappers[2].children).toHaveLength(0);
  });

  it('cancels stale rasterization and keeps the old visible surface until replacement is ready', async () => {
    await pages.prepare();
    pages.attach(1);
    const wrap = host.children[0],
      old = wrap.children[0];
    observer.fire([wrap], true);
    hold = true;
    pages.setZoom(1.2);
    await vi.advanceTimersByTimeAsync(140);
    const task = render.mock.results.at(-1)!.value;
    pages.setZoom(1.3);
    expect(task.cancel).toHaveBeenCalledTimes(1);
    expect(wrap.children[0]).toBe(old);
    hold = false;
    await vi.advanceTimersByTimeAsync(140);
    expect(wrap.children[0]).not.toBe(old);
    expect(wrap.children[0].style.width).toBe('780px');
  });

  it('evicts offscreen surfaces without changing page geometry and repaints on return', async () => {
    await pages.prepare();
    pages.attach(1);
    const wrap = host.children[0];
    observer.fire([wrap], false);
    expect(wrap.children).toHaveLength(0);
    expect(wrap.style.height).toBe('800px');
    observer.fire([wrap], true);
    await flush();
    expect(wrap.children).toHaveLength(1);
  });

  it('cancels pending paints and callbacks on disposal', async () => {
    await pages.prepare();
    pages.attach(1);
    observer.fire([host.children[0]], true);
    pages.setZoom(2);
    render.mockClear();
    painted.mockClear();
    pages.destroy();
    await vi.runAllTimersAsync();
    expect(render).not.toHaveBeenCalled();
    expect(painted).not.toHaveBeenCalled();
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it('never installs a detached render that completes after destruction', async () => {
    await pages.prepare();
    pages.attach(1);
    const wrap = host.children[0],
      old = wrap.children[0];
    observer.fire([wrap], true);
    hold = true;
    pages.setZoom(2);
    await vi.advanceTimersByTimeAsync(140);
    pages.destroy();
    resolveRender?.();
    await flush();
    expect(wrap.children[0]).toBe(old);
  });

  it('applies the latest zoom even when it changed during document preparation', async () => {
    await pages.prepare();
    pages.attach(1.5);
    const wrap = host.children[0];
    expect(wrap.style.width).toBe('900px');
    expect(wrap.children[0].style.transform).toBe('scale(1.5)');
    observer.fire([wrap], true);
    await vi.advanceTimersByTimeAsync(140);
    expect(wrap.children[0].style.width).toBe('900px');
  });

  it('caps Retina bitmap allocation at high zoom without changing display dimensions', async () => {
    await pages.prepare();
    pages.attach(1);
    observer.fire([host.children[0]], true);
    pages.setZoom(4);
    await vi.advanceTimersByTimeAsync(140);
    const surface = host.children[0].children[0],
      canvas = surface.children[0];
    expect(surface.style.width).toBe('2400px');
    expect(canvas.width * canvas.height).toBeLessThan(16_800_000);
    expect(surface.style.setProperty).toHaveBeenCalledWith('--total-scale-factor', '4');
  });
});


describe('PDF first paint failures', () => {
  it('shows a painted page without waiting for the selectable text layer', async () => {
    textRender.mockImplementation(() => new Promise(() => {}));
    await pages.prepare();
    pages.attach(1);
    expect(host.children[0].children).toHaveLength(1);
    expect(host.children[0].children[0].children).toHaveLength(2);
    expect(painted).toHaveBeenCalled();
  });

  it('keeps the canvas when selectable text fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    textRender.mockRejectedValue(new Error('font measurement failed'));
    await pages.prepare();
    pages.attach(1);
    await flush();
    expect(host.children[0].children).toHaveLength(1);
    expect(failed).not.toHaveBeenCalled();
    warning.mockRestore();
  });

  it('propagates first raster failure rather than attaching blank pages', async () => {
    render.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('canvas failed')), cancel: vi.fn() }));
    await expect(pages.prepare()).rejects.toThrow('canvas failed');
    expect(host.children).toHaveLength(0);
  });

  it('reports later raster failures and retains the previous surface', async () => {
    await pages.prepare(); pages.attach(1);
    const wrap = host.children[0], old = wrap.children[0];
    observer.fire([wrap], true);
    render.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('zoom failed')), cancel: vi.fn() }));
    pages.setZoom(1.5);
    await vi.advanceTimersByTimeAsync(140);
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'zoom failed' }));
    expect(wrap.children[0]).toBe(old);
  });
});


it('rebuilds cancelled text when zoom returns to the already painted scale, without rasterizing again', async () => {
  const completeText: Array<() => void> = [];
  textRender.mockImplementation(() => new Promise(resolve => completeText.push(resolve)));
  await pages.prepare();
  pages.attach(1);
  observer.fire([host.children[0]], true);
  expect(textRender).toHaveBeenCalledTimes(2);
  const surface = host.children[0].children[0];
  render.mockClear();
  pages.setZoom(1.2);
  pages.setZoom(1);
  for (const complete of completeText) complete();
  await flush();
  textRender.mockResolvedValue(undefined);
  await vi.advanceTimersByTimeAsync(140);
  expect(textRender).toHaveBeenCalledTimes(3);
  expect(render).not.toHaveBeenCalled();
  expect(host.children[0].children[0]).toBe(surface);
});
it('keeps a completed text layer when a zoom burst returns to its scale', async () => {
  await pages.prepare(); pages.attach(1); await flush();
  observer.fire([host.children[0]], true);
  textRender.mockClear(); render.mockClear();
  pages.setZoom(1.2); pages.setZoom(1);
  await vi.advanceTimersByTimeAsync(140);
  expect(textRender).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
});

it('restarts text extraction cancelled before TextLayer exists, discarding its late result', async () => {
  let resolveText!: (value: { items: never[]; styles: object }) => void;
  getTextContent.mockImplementationOnce(() => new Promise(resolve => { resolveText = resolve; }));
  await pages.prepare(); pages.attach(1);
  observer.fire([host.children[0]], true);
  expect(textRender).toHaveBeenCalledTimes(1);
  render.mockClear();
  pages.setZoom(1.2); pages.setZoom(1);
  await vi.advanceTimersByTimeAsync(140);
  expect(textRender).toHaveBeenCalledTimes(2);
  resolveText({ items: [], styles: {} });
  await flush();
  expect(textRender).toHaveBeenCalledTimes(2);
  expect(render).not.toHaveBeenCalled();
});

// Model real DOM connection state: prepare() paints detached pages, and
// annotations can finish before either the canvas or the host attachment.
describe('PDF link hit areas', () => {
  const citation: LinkAnnotation = {
    subtype: 'Link', rect: [20, 700, 100, 720], dest: 'cite.0@reed2000',
  };
  let followed: ReturnType<typeof vi.fn>;
  let destination: ReturnType<typeof vi.fn>;
  const linkLayer = (surface: Element) => surface.children.find(el => el.className === styles.linkLayer)!;
  const click = async (link: Element) => {
    const event = new Event('click', { bubbles: true, cancelable: true });
    const stop = vi.spyOn(event, 'stopPropagation');
    link.dispatchEvent(event);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
  };

  beforeEach(() => {
    pages.destroy();
    followed = vi.fn();
    destination = vi.fn(async () => [{ num: 42, gen: 0 }, { name: 'XYZ' }, 72, 700, null]);
    getAnnotations.mockResolvedValue([citation]);
    pages = new PdfPages(host as unknown as HTMLDivElement, {
      numPages: 3, getPage, getDestination: destination, getPageIndex: vi.fn(async () => 2),
    } as unknown as PDFDocumentProxy, 1, painted, failed, followed);
  });

  it('keeps early annotations while prepare paints pages outside the document', async () => {
    await pages.prepare();
    const surface = (pages.elements[0] as unknown as Element).children[0];
    expect(surface.isConnected).toBe(false);
    expect(linkLayer(surface).children).toHaveLength(1);
    pages.attach(1);
    expect(surface.isConnected).toBe(true);
    const hit = linkLayer(surface).children[0];
    expect(hit.style).toMatchObject({ left: '20px', top: '80px', width: '80px', height: '20px' });
    await click(hit);
    expect(destination).toHaveBeenCalledWith('cite.0@reed2000');
    expect(followed).toHaveBeenCalledWith({ kind: 'page', page: 3, y: 100 });
  });

  it('keeps annotations that arrive before a slow canvas finishes on a later page', async () => {
    await pages.prepare(); pages.attach(1);
    const wrap = host.children[2];
    hold = true;
    observer.fire([wrap], true);
    await flush();
    expect(wrap.children).toHaveLength(0);
    resolveRender!();
    await flush();
    expect(linkLayer(wrap.children[0]).children).toHaveLength(1);
    await click(linkLayer(wrap.children[0]).children[0]);
    expect(followed).toHaveBeenCalledWith({ kind: 'page', page: 3, y: 100 });
  });

  it('adds delayed annotations after the canvas is already attached', async () => {
    let complete!: (value: LinkAnnotation[]) => void;
    getAnnotations.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await pages.prepare(); pages.attach(1);
    const layer = linkLayer(host.children[0].children[0]);
    expect(layer.children).toHaveLength(0);
    complete([citation]);
    await flush();
    expect(layer.children).toHaveLength(1);
    await click(layer.children[0]);
    expect(followed).toHaveBeenCalledOnce();
  });

  it('recreates working hit areas after offscreen eviction and zoom', async () => {
    await pages.prepare(); pages.attach(1);
    const wrap = host.children[0];
    observer.fire([wrap], false);
    observer.fire([wrap], true);
    await flush();
    await click(linkLayer(wrap.children[0]).children[0]);
    pages.setZoom(2);
    await vi.advanceTimersByTimeAsync(140);
    const hit = linkLayer(wrap.children[0]).children[0];
    expect(hit.style).toMatchObject({ left: '40px', top: '160px', width: '160px', height: '40px' });
    await click(hit);
    expect(followed).toHaveBeenCalledTimes(2);
    expect(followed).toHaveBeenLastCalledWith({ kind: 'page', page: 3, y: 100 });
  });

  it('never adds annotations when their document was destroyed while loading', async () => {
    let complete!: (value: LinkAnnotation[]) => void;
    getAnnotations.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await pages.prepare(); pages.attach(1);
    const layer = linkLayer(host.children[0].children[0]);
    pages.destroy();
    complete([citation]);
    await flush();
    expect(layer.children).toHaveLength(0);
    expect(followed).not.toHaveBeenCalled();
  });

  it('ignores a resolved click from a surface evicted while its destination was loading', async () => {
    let complete!: (value: unknown[]) => void;
    destination.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await pages.prepare(); pages.attach(1);
    const wrap = host.children[0];
    await click(linkLayer(wrap.children[0]).children[0]);
    observer.fire([wrap], false);
    complete([2, { name: 'XYZ' }, 72, 700, null]);
    await flush();
    expect(followed).not.toHaveBeenCalled();
  });

  it('delivers external links without triggering page selection or browser navigation', async () => {
    getAnnotations.mockResolvedValue([{ subtype: 'Link', rect: [20, 700, 100, 720], url: 'https://doi.org/10.1000/test' }]);
    await pages.prepare(); pages.attach(1);
    await click(linkLayer(host.children[0].children[0]).children[0]);
    expect(followed).toHaveBeenCalledWith({ kind: 'url', url: 'https://doi.org/10.1000/test' });
    expect(destination).not.toHaveBeenCalled();
  });
});
