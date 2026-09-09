import { TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import { capturePageAnchor, restorePageAnchor, type ZoomPoint } from './zoom';
import { isLink, resolveLink, type LinkAnnotation, type PdfLinkTarget } from './links';
import styles from '../components/PdfViewer.module.css';

type Slot = {
  page: PDFPageProxy;
  wrap: HTMLDivElement;
  width: number;
  height: number;
  surface?: HTMLDivElement;
  paintedZoom?: number;
  task?: RenderTask;
  text?: TextLayer;
  layer?: HTMLDivElement;
  textPending?: boolean;
  textReady?: boolean;
  revision: number;
};

// Page geometry and wrappers live for the PDF's lifetime, not one zoom step.
// Only nearby pages own canvases/text. Zoom stretches those surfaces immediately;
// rasterization follows after input settles, without replacing the old surface early.
export class PdfPages {
  private slots: Slot[] = [];
  private observer?: IntersectionObserver;
  private nearby = new Set<Slot>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private attached = false;
  private zoom: number;

  constructor(
    private host: HTMLDivElement,
    private doc: PDFDocumentProxy,
    zoom: number,
    private onPaint: () => void,
    private onError: (error: unknown) => void,
    private onLink?: (target: PdfLinkTarget) => void,
  ) {
    this.zoom = zoom;
  }

  get elements() {
    return this.slots.map((slot) => slot.wrap);
  }

  async prepare() {
    for (let n = 1; n <= this.doc.numPages; n++) {
      const page = await this.doc.getPage(n);
      if (this.disposed) return;
      const viewport = page.getViewport({ scale: 1 });
      const wrap = document.createElement('div');
      wrap.className = styles.page;
      wrap.dataset.page = String(n);
      this.slots.push({
        page,
        wrap,
        width: viewport.width,
        height: viewport.height,
        revision: 0,
      });
    }
    this.layout();
    // Keep the previous document visible until the same reading region is ready.
    const anchor = capturePageAnchor(this.host, Array.from(this.host.children) as HTMLElement[]);
    const index = Math.min(anchor?.index ?? 0, this.slots.length - 1);
    await Promise.all(this.slots.slice(index, index + 2).map((slot) => this.paint(slot)));
  }

  attach(zoom: number) {
    const anchor = capturePageAnchor(this.host, Array.from(this.host.children) as HTMLElement[]);
    const initialZoom = this.zoom;
    this.zoom = zoom;
    this.layout();
    this.host.replaceChildren(...this.elements);
    this.attached = true;
    restorePageAnchor(this.host, this.elements, anchor);
    const slots = new Map(this.slots.map((slot) => [slot.wrap, slot]));
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slot = slots.get(entry.target as HTMLDivElement)!;
          if (entry.isIntersecting) {
            this.nearby.add(slot);
            if (!this.timer) void this.paint(slot).catch(this.onError);
          } else {
            this.nearby.delete(slot);
            this.cancel(slot);
            slot.wrap.replaceChildren();
            slot.surface = undefined;
            slot.layer = undefined;
            slot.textReady = false;
            slot.paintedZoom = undefined;
          }
        }
      },
      { root: this.host, rootMargin: '500px 0px' },
    );
    for (const slot of this.slots) this.observer.observe(slot.wrap);
    if (initialZoom !== zoom) this.schedulePaint();
    this.onPaint();
  }

  setZoom(zoom: number, point?: ZoomPoint) {
    if (this.disposed || zoom === this.zoom) return;
    const anchor = capturePageAnchor(this.host, this.elements, point);
    this.zoom = zoom;
    for (const slot of this.slots) this.cancel(slot);
    this.layout();
    restorePageAnchor(this.host, this.elements, anchor);
    this.schedulePaint();
  }

  private layout() {
    for (const slot of this.slots) {
      slot.wrap.style.width = `${slot.width * this.zoom}px`;
      slot.wrap.style.height = `${slot.height * this.zoom}px`;
      if (slot.surface) slot.surface.style.transform = `scale(${this.zoom / slot.paintedZoom!})`;
    }
  }

  private schedulePaint() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const slot of this.nearby) void this.paint(slot).catch(this.onError);
    }, 140);
  }

  private cancel(slot: Slot) {
    ++slot.revision;
    slot.task?.cancel();
    slot.text?.cancel();
    slot.task = undefined;
    slot.text = undefined;
    slot.textPending = false;
  }

  private async paint(slot: Slot) {
    if (this.disposed || slot.task || slot.textPending) return;
    const revision = ++slot.revision;
    const zoom = this.zoom;
    const viewport = slot.page.getViewport({ scale: zoom });
    if (slot.paintedZoom === zoom && slot.layer) {
      // A cancelled text layer does not invalidate an already sharp canvas.
      if (!slot.textReady) {
        slot.layer.replaceChildren();
        void this.paintText(slot, slot.layer, viewport, revision);
      }
      return;
    }
    // Bound each bitmap, especially on Retina at 400%. Display size is unchanged.
    const dpr = Math.min(
      window.devicePixelRatio || 1,
      Math.sqrt(16_777_216 / (viewport.width * viewport.height)),
      8192 / Math.max(viewport.width, viewport.height),
    );
    const surface = document.createElement('div');
    surface.className = styles.surface;
    surface.style.width = `${viewport.width}px`;
    surface.style.height = `${viewport.height}px`;
    surface.style.setProperty('--total-scale-factor', String(zoom));
    surface.style.setProperty('--scale-factor', String(zoom));
    const canvas = document.createElement('canvas');
    const raster = slot.page.getViewport({ scale: zoom * dpr });
    canvas.width = Math.ceil(raster.width);
    canvas.height = Math.ceil(raster.height);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const layer = document.createElement('div');
    layer.className = `textLayer ${styles.textLayer}`;
    surface.append(canvas, layer);
    if (this.onLink) surface.append(this.linkLayer(slot, viewport));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the PDF canvas.');
    try {
      slot.task = slot.page.render({
        canvas,
        canvasContext: context,
        viewport: raster,
      });
      await slot.task.promise;
      if (this.disposed || revision !== slot.revision) return;
      slot.wrap.replaceChildren(surface);
      slot.surface = surface;
      slot.paintedZoom = zoom;
      slot.layer = layer;
      slot.textReady = false;
      if (this.attached) this.onPaint();
      // Selection/search must never gate a successfully painted page.
      void this.paintText(slot, layer, viewport, revision);
    } catch (error) {
      if (!this.disposed && revision === slot.revision)
        throw error;
    } finally {
      if (revision === slot.revision) {
        slot.task = undefined;
      }
    }
  }

  // Hyperref targets (\cite, \ref, ToC) are Link annotations. One hit area per
  // annotation, sized in CSS pixels at paint zoom; the surface transform keeps
  // it aligned while a zoom step is still rasterizing. Resolution happens on
  // click because named destinations require a document lookup.
  private linkLayer(slot: Slot, viewport: ReturnType<PDFPageProxy['getViewport']>) {
    const layer = document.createElement('div');
    layer.className = styles.linkLayer;
    void slot.page.getAnnotations().then((annotations: LinkAnnotation[]) => {
      // prepare() and zoom paint off-DOM. Fast annotations are still valid
      // before the canvas finishes; only clicks require an attached surface.
      if (this.disposed) return;
      for (const annotation of annotations) {
        if (!isLink(annotation)) continue;
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annotation.rect!);
        const hit = document.createElement('a');
        hit.className = styles.link;
        hit.href = typeof annotation.url === 'string' ? annotation.url : '#';
        hit.title = typeof annotation.url === 'string' ? annotation.url : '';
        hit.style.left = `${Math.min(x1, x2)}px`;
        hit.style.top = `${Math.min(y1, y2)}px`;
        hit.style.width = `${Math.abs(x2 - x1)}px`;
        hit.style.height = `${Math.abs(y2 - y1)}px`;
        hit.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          void resolveLink(this.doc, annotation)
            .then((target) => {
              if (target && !this.disposed && layer.isConnected) this.onLink?.(target);
            })
            .catch((error) => console.warn('PDF link unresolved', error));
        });
        layer.append(hit);
      }
    }).catch((error) => console.warn('PDF links unavailable', slot.wrap.dataset.page, error));
    return layer;
  }

  private async paintText(
    slot: Slot,
    layer: HTMLDivElement,
    viewport: ReturnType<PDFPageProxy['getViewport']>,
    revision: number,
  ) {
    slot.textPending = true;
    try {
      const content = await slot.page.getTextContent();
      if (this.disposed || revision !== slot.revision) return;
      slot.text = new TextLayer({ textContentSource: content, container: layer, viewport });
      await slot.text.render();
      if (this.disposed || revision !== slot.revision) return;
      // PDF.js exposes one div per text item, including empty items. Keep its
      // index so full-document matches map correctly even across text runs.
      slot.text.textDivs.forEach((div, index) => { div.dataset.textIndex = String(index); });
      slot.textReady = true;
      if (this.attached) this.onPaint();
    } catch (error) {
      if (!this.disposed && revision === slot.revision)
        console.warn('PDF text selection unavailable', slot.wrap.dataset.page, error);
    } finally {
      if (revision === slot.revision) {
        slot.text = undefined;
        slot.textPending = false;
      }
    }
  }

  destroy() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.observer?.disconnect();
    for (const slot of this.slots) this.cancel(slot);
    this.nearby.clear();
  }
}
