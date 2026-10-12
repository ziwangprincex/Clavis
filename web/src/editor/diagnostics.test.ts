import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { problemGutter, problems, setProblems, type LineProblem } from './diagnostics';

function marked(state: EditorState) {
  const out: { line: number; severity: string; message: string }[] = [];
  state.field(problems).between(0, state.doc.length, (from, _to, marker) => {
    const { severity, message } = marker as unknown as LineProblem;
    out.push({ line: state.doc.lineAt(from).number, severity, message });
  });
  return out;
}

describe('compile problems in the margin', () => {
  const doc = 'line one\nline two\nline three\n';
  const start = (list: LineProblem[]) => EditorState.create({ doc, extensions: problemGutter() })
    .update({ effects: setProblems.of(list) }).state;

  it('marks each reported line once, an error outranking warnings', () => {
    const state = start([
      { line: 2, severity: 'warning', message: 'Overfull \\hbox' },
      { line: 2, severity: 'error', message: 'Undefined control sequence' },
      { line: 3, severity: 'warning', message: 'a' },
      { line: 3, severity: 'warning', message: 'b' },
      { line: 99, severity: 'error', message: 'past the end' },
    ]);
    expect(marked(state)).toEqual([
      { line: 2, severity: 'error', message: 'Undefined control sequence' },
      { line: 3, severity: 'warning', message: 'a\nb' },
    ]);
  });

  it('follows the text while it is edited and is replaced by the next compile', () => {
    let state = start([{ line: 2, severity: 'error', message: 'x' }]);
    state = state.update({ changes: { from: 0, insert: 'new first line\n' } }).state;
    expect(marked(state).map(item => item.line)).toEqual([3]);
    state = state.update({ effects: setProblems.of([]) }).state;
    expect(marked(state)).toEqual([]);
  });
});
