export interface ZoomPoint {
  x: number;
  y: number;
}

export function wheelZoom(zoom: number, delta: number, mode: number, height: number) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? height : 1);
  return zoom * Math.exp(-pixels * 0.002);
}

// Native listeners are necessary: React's delegated wheel listener is passive.
// WebKit emits GestureEvents for trackpad pinch; other engines use ctrl+wheel.
export function bindPreviewZoom(
  host: HTMLElement,
  getZoom: () => number,
  update: (zoom: number, point: ZoomPoint) => void,
  min = 0.5,
  max = 4,
) {
  let frame = 0;
  let pending: { zoom: number; point: ZoomPoint } | undefined;
  let gestureStart: number | undefined;
  const queue = (zoom: number, point: ZoomPoint) => {
    pending = { zoom: Math.max(min, Math.min(max, zoom)), point };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const next = pending!;
      pending = undefined;
      update(next.zoom, next.point);
    });
  };
  const wheel = (event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (gestureStart !== undefined) return;
    queue(wheelZoom(pending?.zoom ?? getZoom(), event.deltaY, event.deltaMode, host.clientHeight), {
      x: event.clientX,
      y: event.clientY,
    });
  };
  type Gesture = Event & { scale: number; clientX: number; clientY: number };
  const start = (event: Event) => {
    event.preventDefault();
    gestureStart = pending?.zoom ?? getZoom();
  };
  const change = (event: Event) => {
    event.preventDefault();
    if (gestureStart === undefined) return;
    const gesture = event as Gesture;
    queue(gestureStart * gesture.scale, {
      x: gesture.clientX,
      y: gesture.clientY,
    });
  };
  const end = (event: Event) => {
    change(event);
    gestureStart = undefined;
  };
  host.addEventListener('wheel', wheel, { passive: false });
  host.addEventListener('gesturestart', start, { passive: false });
  host.addEventListener('gesturechange', change, { passive: false });
  host.addEventListener('gestureend', end, { passive: false });
  return () => {
    cancelAnimationFrame(frame);
    host.removeEventListener('wheel', wheel);
    host.removeEventListener('gesturestart', start);
    host.removeEventListener('gesturechange', change);
    host.removeEventListener('gestureend', end);
  };
}

export function capturePageAnchor(host: HTMLElement, pages: HTMLElement[], point?: ZoomPoint) {
  if (!pages.length) return null;
  const box = host.getBoundingClientRect();
  const target = point ?? {
    x: box.left + host.clientWidth / 2,
    y: box.top + host.clientHeight / 2,
  };
  let low = 0,
    high = pages.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (pages[mid].getBoundingClientRect().bottom < target.y) low = mid + 1;
    else high = mid;
  }
  const rect = pages[low].getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    index: low,
    x: (target.x - rect.left) / rect.width,
    y: (target.y - rect.top) / rect.height,
    point: target,
  };
}

export function restorePageAnchor(
  host: HTMLElement,
  pages: HTMLElement[],
  anchor: ReturnType<typeof capturePageAnchor>,
) {
  if (!anchor || !pages.length) return;
  const rect = pages[Math.min(anchor.index, pages.length - 1)].getBoundingClientRect();
  host.scrollLeft += rect.left + anchor.x * rect.width - anchor.point.x;
  host.scrollTop += rect.top + anchor.y * rect.height - anchor.point.y;
}
