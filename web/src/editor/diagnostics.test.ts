import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { showTooltip } from '@codemirror/view';
import { openProblem, problemGutter, problemLineNumbers, problems, setProblems, type LineProblem } from './diagnostics';
import { nearLines } from './lineNumberShading';

function marked(state: EditorState) {
  const out: { line: number; severity: string; message: string }[] = [];
  state.field(problems).between(0, state.doc.length, (from, _to, marker) => {
    const { severity, messages } = marker as unknown as { severity: LineProblem['severity']; messages: string[] };
    out.push({ line: state.doc.lineAt(from).number, severity, message: messages.join('\n') });
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

  it('opens a marked line\'s messages beside it and closes them on the next edit', () => {
    let state = start([{ line: 2, severity: 'error', message: 'Undefined control sequence' }]);
    const lineTwo = state.doc.line(2).from;
    state = state.update({ effects: openProblem.of(lineTwo) }).state;
    expect(state.facet(showTooltip).filter(Boolean).map(tip => tip!.pos)).toEqual([lineTwo]);
    // An unmarked line opens nothing.
    expect(state.update({ effects: openProblem.of(0) }).state.facet(showTooltip).filter(Boolean)).toEqual([]);
    state = state.update({ changes: { from: 0, insert: 'x' } }).state;
    expect(state.facet(showTooltip).filter(Boolean)).toEqual([]);
  });

  it('tags the line numbers of marked lines and shades those near the cursor', () => {
    const state = start([{ line: 3, severity: 'warning', message: 'a' }]);
    const tags: string[] = [];
    problemLineNumbers(state).between(0, state.doc.length, (from, _to, marker) => {
      tags.push(`${state.doc.lineAt(from).number}:${marker.elementClass}`);
    });
    expect(tags).toEqual(['3:cm-line-problem cm-line-problem-warning']);
    const near: string[] = [];
    const many = EditorState.create({ doc: 'a\nb\nc\nd\ne\nf' });
    nearLines(many, 2).between(0, many.doc.length, (from, _to, marker) => {
      near.push(`${many.doc.lineAt(from).number}:${marker.elementClass}`);
    });
    expect(near).toEqual(['1:cm-line-near-1', '3:cm-line-near-1', '4:cm-line-near-2', '5:cm-line-near-3']);
  });
});
