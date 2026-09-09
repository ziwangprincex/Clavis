import { describe, expect, it } from 'vitest';
import { constrainSidebarWidth, constrainEditorRatio, constrainLogHeight } from './paneConstraints';

describe('pane constraints', () => {
  it('reserves both writing panes at the minimum supported window width', () => {
    const sidebar = constrainSidebarWidth(640, 720, 'split');
    expect(sidebar).toBe(278);
    expect(720 - sidebar - 2).toBe(440);
  });
  it('reserves a usable single pane in editor and preview modes', () => {
    expect(constrainSidebarWidth(640, 720, 'editor')).toBe(399);
    expect(constrainSidebarWidth(640, 720, 'preview')).toBe(399);
  });
  it('restores the preferred sidebar width after widening', () => {
    expect(constrainSidebarWidth(600, 720, 'split')).toBe(278);
    expect(constrainSidebarWidth(600, 1400, 'split')).toBe(600);
  });
  it('bounds invalid and unmeasured widths', () => {
    expect(constrainSidebarWidth(0, 0, 'split')).toBe(232);
    expect(constrainSidebarWidth(NaN, 1400, 'split')).toBe(232);
    expect(constrainSidebarWidth(10, 1400, 'split')).toBe(200);
    expect(constrainSidebarWidth(1000, 1400, 'split')).toBe(640);
  });
  it('reclamps extreme persisted ratios when shrinking', () => {
    expect(constrainEditorRatio(0.9, 441)).toBe(0.5);
    expect(constrainEditorRatio(0.9, 601)).toBeCloseTo(380 / 600);
    expect(constrainEditorRatio(0.1, 601)).toBeCloseTo(220 / 600);
    expect(constrainEditorRatio(0.7, 1400)).toBe(0.7);
  });
});


describe('problems panel height', () => {
  it('reserves tabs and writing space after a large saved panel meets a small window', () => {
    expect(constrainLogHeight(600, 400)).toBe(220);
    expect(constrainLogHeight(600, 800)).toBe(600);
  });
  it('preserves a short preference and gives malformed settings the ordinary default', () => {
    expect(constrainLogHeight(100, 400)).toBe(100);
    expect(constrainLogHeight(0, 400)).toBe(220);
    expect(constrainLogHeight(NaN, 500)).toBe(220);
    expect(constrainLogHeight(Infinity, 500)).toBe(220);
    expect(constrainLogHeight(220, 0)).toBe(220);
    expect(constrainLogHeight(220, 240)).toBe(80);
  });
});
