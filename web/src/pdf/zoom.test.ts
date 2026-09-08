import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindPreviewZoom, capturePageAnchor, restorePageAnchor, wheelZoom } from './zoom';

function host() {
  return Object.assign(new EventTarget(), {
    clientHeight: 800,
    clientWidth: 600,
  }) as unknown as HTMLElement;
}
function event(type: string, props: object = {}) {
  return Object.assign(new Event(type, { cancelable: true }), props);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('preview zoom input', () => {
  it('accumulates tiny wheel deltas but updates only once per frame', () => {
    const el = host();
    let zoom = 1;
    const update = vi.fn((value: number) => {
      zoom = value;
    });
    const dispose = bindPreviewZoom(el, () => zoom, update);
    for (let n = 0; n < 100; n++)
      el.dispatchEvent(
        event('wheel', {
          ctrlKey: true,
          deltaY: -0.1,
          deltaMode: 0,
          clientX: 200,
          clientY: 300,
        }),
      );
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(update).toHaveBeenCalledTimes(1);
    expect(zoom).toBeCloseTo(Math.exp(0.02));
    expect(update).toHaveBeenLastCalledWith(zoom, { x: 200, y: 300 });
    dispose();
  });

  it('does not intercept ordinary scrolling', () => {
    const el = host();
    const update = vi.fn();
    const dispose = bindPreviewZoom(el, () => 1, update);
    const scroll = event('wheel', { deltaY: 100, deltaMode: 0 });
    el.dispatchEvent(scroll);
    vi.runAllTimers();
    expect(scroll.defaultPrevented).toBe(false);
    expect(update).not.toHaveBeenCalled();
    dispose();
  });

  it('uses WebKit gesture scale and ignores duplicate ctrl-wheel during pinch', () => {
    const el = host();
    let zoom = 1.5;
    const update = vi.fn((value: number) => {
      zoom = value;
    });
    const dispose = bindPreviewZoom(el, () => zoom, update);
    el.dispatchEvent(event('gesturestart', { scale: 1 }));
    el.dispatchEvent(event('gesturechange', { scale: 1.2, clientX: 80, clientY: 90 }));
    el.dispatchEvent(event('wheel', { ctrlKey: true, deltaY: -100, deltaMode: 0 }));
    vi.advanceTimersByTime(16);
    expect(zoom).toBeCloseTo(1.8);
    el.dispatchEvent(event('gestureend', { scale: 1.3, clientX: 80, clientY: 90 }));
    vi.advanceTimersByTime(16);
    expect(zoom).toBeCloseTo(1.95);
    dispose();
  });

  it('normalizes line/page wheel units and makes opposite deltas reversible', () => {
    expect(wheelZoom(1, 1, 1, 800)).toBe(wheelZoom(1, 16, 0, 800));
    expect(wheelZoom(1, 1, 2, 800)).toBe(wheelZoom(1, 800, 0, 800));
    expect(wheelZoom(wheelZoom(1.8, 25, 0, 800), -25, 0, 800)).toBeCloseTo(1.8);
  });

  it('clamps scales and cancels pending updates/listeners when disposed', () => {
    const el = host();
    const update = vi.fn();
    const dispose = bindPreviewZoom(el, () => 1, update);
    const wheel = () => event('wheel', { metaKey: true, deltaY: -10000, deltaMode: 0 });
    const first = wheel();
    el.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(16);
    expect(update.mock.calls[0][0]).toBe(4);
    el.dispatchEvent(wheel());
    dispose();
    el.dispatchEvent(wheel());
    vi.runAllTimers();
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('reading anchor', () => {
  it('preserves both coordinates across scale, centering and page-gap changes', () => {
    const el = {
      clientHeight: 600,
      clientWidth: 800,
      scrollTop: 500,
      scrollLeft: 20,
      getBoundingClientRect: () => ({ left: 50, top: 80 }),
    } as HTMLElement;
    let box = { left: 150, top: 100, width: 600, height: 800, bottom: 900 };
    const page = { getBoundingClientRect: () => box } as HTMLElement;
    const anchor = capturePageAnchor(el, [page], { x: 300, y: 500 });
    box = { left: 20, top: 124, width: 900, height: 1200, bottom: 1324 };
    restorePageAnchor(el, [page], anchor);
    expect(el.scrollLeft).toBe(-35);
    expect(el.scrollTop).toBe(724);
  });

  it('finds a page in a long document with logarithmic geometry reads', () => {
    const el = host();
    el.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    const read = vi.fn((index: number) => ({
      left: 0,
      top: index * 1000,
      width: 600,
      height: 980,
      bottom: index * 1000 + 980,
    }));
    const pages = Array.from(
      { length: 1000 },
      (_, i) => ({ getBoundingClientRect: () => read(i) }) as HTMLElement,
    );
    expect(capturePageAnchor(el, pages, { x: 200, y: 899400 })?.index).toBe(899);
    expect(read.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it('handles empty/hidden pages and clamps an anchor after a shorter recompile', () => {
    const el = Object.assign(host(), {
      scrollTop: 0,
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    });
    expect(capturePageAnchor(el, [])).toBeNull();
    const page = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 10,
        bottom: 110,
        width: 100,
        height: 100,
      }),
    } as HTMLElement;
    restorePageAnchor(el, [page], {
      index: 99,
      x: 0,
      y: 0.5,
      point: { x: 0, y: 40 },
    });
    expect(el.scrollTop).toBe(20);
    expect(
      capturePageAnchor(el, [
        {
          getBoundingClientRect: () => ({ width: 0, height: 0 }),
        } as HTMLElement,
      ]),
    ).toBeNull();
  });
});
