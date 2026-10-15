// Line numbers as Texifier draws them: a compile problem's line number takes
// the problem's colour, and numbers fade with distance from the cursor's line
// so the current position stands out.

import { RangeSet, type Extension } from '@codemirror/state';
import { EditorView, GutterMarker, lineNumberMarkers } from '@codemirror/view';
import { problemLineNumbers, problems } from './diagnostics';

class Nearness extends GutterMarker {
  constructor(readonly distance: number) {
    super();
    this.elementClass = `cm-line-near-${distance}`;
  }
  eq(other: Nearness) { return other.distance === this.distance; }
}

const NEAR = [1, 2, 3].map(distance => new Nearness(distance));

/** Classes for the lines just above and below the cursor's line. */
export function nearLines(state: { doc: { lines: number; line(n: number): { from: number } } }, cursorLine: number) {
  const ranges = [];
  for (let n = Math.max(1, cursorLine - 3); n <= Math.min(state.doc.lines, cursorLine + 3); n++) {
    if (n !== cursorLine) ranges.push(NEAR[Math.abs(n - cursorLine) - 1].range(state.doc.line(n).from));
  }
  return RangeSet.of(ranges);
}

export const lineNumberShading: Extension = [
  lineNumberMarkers.compute([problems], problemLineNumbers),
  lineNumberMarkers.compute(['selection', 'doc'], state => nearLines(state, state.doc.lineAt(state.selection.main.head).number)),
  EditorView.baseTheme({
    '.cm-lineNumbers .cm-gutterElement': { opacity: '0.55' },
    '.cm-lineNumbers .cm-line-near-3': { opacity: '0.66' },
    '.cm-lineNumbers .cm-line-near-2': { opacity: '0.77' },
    '.cm-lineNumbers .cm-line-near-1': { opacity: '0.88' },
    '.cm-lineNumbers .cm-activeLineGutter': { opacity: '1' },
    // The number itself takes the problem's colour; a filled tag would grow with a wrapped line.
    '.cm-lineNumbers .cm-gutterElement.cm-line-problem': { opacity: '1', fontWeight: '650' },
    '.cm-lineNumbers .cm-line-problem-error': { color: 'var(--error)' },
    '.cm-lineNumbers .cm-line-problem-warning': { color: 'color-mix(in srgb, var(--warning) 70%, var(--text))' },
  }),
];
