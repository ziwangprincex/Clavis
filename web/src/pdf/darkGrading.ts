// Dark paper for the PDF preview that keeps colour. Inverting a page turns
// photos and plots into negatives and shifts every hue; instead only colours
// near the grey line (black text, white paper, grey rules) are mapped onto a
// dark palette, and the mapping fades out as a colour gets more saturated, so
// links, highlights and figures keep the colours the author chose. This is the
// approach Texifier's PDF viewer takes for its dark mode.

/** The pdf.js operator codes `imageRects` reads (`OPS` from pdfjs-dist). */
export interface PdfOps {
  save: number; restore: number; transform: number;
  paintFormXObjectBegin: number; paintFormXObjectEnd: number;
  paintImageXObject: number; paintInlineImageXObject: number;
  paintInlineImageXObjectGroup: number; paintImageXObjectRepeat: number;
}

export type Rgb = readonly [number, number, number];

/** Dark paper and light ink, as 0–255 channels. */
export const DARK_PAPER: Rgb = [30, 31, 34];
export const DARK_INK: Rgb = [221, 222, 224];

/** Distance from the grey line (in unit RGB) beyond which a colour is left alone. */
const TAPER = 0.4;
const AXIS = Math.sqrt(1 / 3);

export interface PixelRect { x: number; y: number; width: number; height: number }

/** Grades RGBA pixels in place: white becomes `paper`, black becomes `ink`. */
export function gradePixels(data: Uint8ClampedArray, paper: Rgb = DARK_PAPER, ink: Rgb = DARK_INK): void {
  const [pr, pg, pb] = paper, [ir, ig, ib] = ink;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    // Distance of (r, g, b) from its projection onto the grey diagonal.
    const along = (r + g + b) * AXIS * AXIS;
    const distance = Math.hypot(r - along, g - along, b - along);
    const strength = Math.max(TAPER - distance, 0) / TAPER;
    if (strength === 0) continue;
    // Lightness is inverted onto paper..ink; the small tint is added back, so a
    // pale blue box turns dark blue rather than the dark orange an inversion gives.
    const lightness = (r + g + b) / 3;
    const keep = 1 - strength;
    data[i] = (ir + (pr - ir) * lightness + (r - lightness) * 255) * strength + data[i] * keep;
    data[i + 1] = (ig + (pg - ig) * lightness + (g - lightness) * 255) * strength + data[i + 1] * keep;
    data[i + 2] = (ib + (pb - ib) * lightness + (b - lightness) * 255) * strength + data[i + 2] * keep;
  }
}

type Matrix = [number, number, number, number, number, number];

/** pdf.js's Util.transform: `m2` applied first, then `m1`. */
function multiply(m1: Matrix, m2: readonly number[]): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** The device-pixel box of the unit square, where PDF draws every image. */
function unitSquare(m: Matrix): PixelRect {
  const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
  const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
  const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys));
  return { x, y, width: Math.ceil(Math.max(...xs)) - x, height: Math.ceil(Math.max(...ys)) - y };
}

/** Where raster images land on a page rendered with `viewport` (its `transform`),
 *  from the page's operator list. Stencil masks are left out: they are painted
 *  in the fill colour, like text. */
export function imageRects(OPS: PdfOps, operators: { fnArray: number[]; argsArray: unknown[] }, viewport: readonly number[]): PixelRect[] {
  const rects: PixelRect[] = [];
  const stack: Matrix[] = [];
  let ctm = multiply([1, 0, 0, 1, 0, 0], viewport);
  const { fnArray, argsArray } = operators;
  for (let i = 0; i < fnArray.length; i++) {
    const args = (argsArray[i] ?? []) as unknown[];
    switch (fnArray[i]) {
      case OPS.save: stack.push(ctm); break;
      case OPS.restore: ctm = stack.pop() ?? ctm; break;
      case OPS.transform: ctm = multiply(ctm, args as number[]); break;
      case OPS.paintFormXObjectBegin:
        stack.push(ctm);
        if (Array.isArray(args[0])) ctm = multiply(ctm, args[0] as number[]);
        break;
      case OPS.paintFormXObjectEnd: ctm = stack.pop() ?? ctm; break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
        rects.push(unitSquare(ctm));
        break;
      case OPS.paintInlineImageXObjectGroup:
        for (const entry of (args[1] ?? []) as { transform: number[] }[]) rects.push(unitSquare(multiply(ctm, entry.transform)));
        break;
      case OPS.paintImageXObjectRepeat: {
        const [, scaleX, scaleY, positions] = args as [unknown, number, number, number[]];
        for (let p = 0; p + 1 < positions.length; p += 2) rects.push(unitSquare(multiply(ctm, [scaleX, 0, 0, scaleY, positions[p], positions[p + 1]])));
        break;
      }
    }
  }
  return rects.filter(rect => rect.width > 0 && rect.height > 0);
}

/** Grades a rendered canvas, leaving `keep` (image areas) as painted. */
export function gradeCanvas(context: CanvasRenderingContext2D, keep: PixelRect[] = []): void {
  const { width, height } = context.canvas;
  const saved = keep.map(rect => {
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
    const w = Math.min(width, rect.x + rect.width) - x, h = Math.min(height, rect.y + rect.height) - y;
    return w > 0 && h > 0 ? { x, y, pixels: context.getImageData(x, y, w, h) } : null;
  });
  const page = context.getImageData(0, 0, width, height);
  gradePixels(page.data);
  context.putImageData(page, 0, 0);
  for (const area of saved) if (area) context.putImageData(area.pixels, area.x, area.y);
}
