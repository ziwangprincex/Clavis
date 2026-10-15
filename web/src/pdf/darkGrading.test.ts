import { describe, expect, it } from 'vitest';
import { DARK_INK, DARK_PAPER, gradePixels, imageRects } from './darkGrading';

const pixel = (r: number, g: number, b: number, a = 255) => {
  const data = new Uint8ClampedArray([r, g, b, a]);
  gradePixels(data);
  return [...data];
};

describe('dark paper grading', () => {
  it('turns white paper dark and black ink light', () => {
    expect(pixel(255, 255, 255)).toEqual([...DARK_PAPER, 255]);
    expect(pixel(0, 0, 0)).toEqual([...DARK_INK, 255]);
  });

  it('keeps saturated colours and transparency as they are', () => {
    expect(pixel(220, 20, 60)).toEqual([220, 20, 60, 255]);
    expect(pixel(0, 102, 204)).toEqual([0, 102, 204, 255]);
    expect(pixel(255, 255, 255, 0)).toEqual([255, 255, 255, 0]);
  });

  it('fades the mapping for slightly tinted colours', () => {
    const [r, , b] = pixel(235, 245, 255);
    // Darkened, and still blue rather than the orange an inversion gives.
    expect(r).toBeLessThan(80);
    expect(b).toBeGreaterThan(r);
  });
});

// pdf.js's numbering (OPS in pdfjs-dist), which cannot load without a browser.
const OPS = {
  save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75,
  paintImageMaskXObject: 83, paintImageXObject: 85, paintInlineImageXObject: 86,
  paintInlineImageXObjectGroup: 87, paintImageXObjectRepeat: 88,
};

describe('image areas from the operator list', () => {
  // A 100 × 200 pt page at scale 2: PDF y runs up, device y down.
  const viewport = [2, 0, 0, -2, 0, 400];

  it('maps the unit square of each image through the current transform', () => {
    const rects = imageRects(OPS, {
      fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintImageMaskXObject],
      argsArray: [[], [50, 0, 0, 40, 10, 20], ['img1', 1, 1], [], [{}]],
    }, viewport);
    expect(rects).toEqual([{ x: 20, y: 280, width: 100, height: 80 }]);
  });

  it('follows form XObject matrices and repeated images', () => {
    const rects = imageRects(OPS, {
      fnArray: [OPS.paintFormXObjectBegin, OPS.paintImageXObjectRepeat, OPS.paintFormXObjectEnd],
      argsArray: [[[1, 0, 0, 1, 5, 5], null], ['img', 10, 10, [0, 0, 20, 0]], []],
    }, viewport);
    expect(rects).toEqual([
      { x: 10, y: 370, width: 20, height: 20 },
      { x: 50, y: 370, width: 20, height: 20 },
    ]);
  });
});
