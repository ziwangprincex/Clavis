// Compile problems in the editor margin, as Texifier marks errors beside the
// line. Markers follow the text while it is edited and are replaced by the next
// compile's results; hovering one shows the messages.

import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';

export interface LineProblem { line: number; severity: 'error' | 'warning'; message: string }

class ProblemMarker extends GutterMarker {
  constructor(readonly severity: LineProblem['severity'], readonly message: string) { super(); }
  eq(other: ProblemMarker) { return other.severity === this.severity && other.message === this.message; }
  toDOM() {
    const dom = document.createElement('span');
    dom.className = `cm-problem cm-problem-${this.severity}`;
    dom.title = this.message;
    dom.setAttribute('aria-label', this.message);
    return dom;
  }
}

export const setProblems = StateEffect.define<LineProblem[]>();

/** One marker per line: an error outranks warnings, messages on the same line are joined. */
function markers(problems: LineProblem[], doc: { lines: number; line(n: number): { from: number } }) {
  const byLine = new Map<number, LineProblem>();
  for (const problem of problems) {
    if (problem.line < 1 || problem.line > doc.lines) continue;
    const seen = byLine.get(problem.line);
    if (!seen || (seen.severity === 'warning' && problem.severity === 'error')) byLine.set(problem.line, problem);
    else if (seen.severity === problem.severity) byLine.set(problem.line, { ...seen, message: `${seen.message}\n${problem.message}` });
  }
  return RangeSet.of([...byLine.values()].sort((a, b) => a.line - b.line)
    .map(problem => new ProblemMarker(problem.severity, problem.message).range(doc.line(problem.line).from)));
}

export const problems = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setProblems)) next = markers(effect.value, tr.state.doc);
    return next;
  },
});

/** `onSelect` runs when a marked line's marker is clicked (to show the problem list). */
export const problemGutter = (onSelect?: () => void): Extension => [
  problems,
  gutter({
    class: 'cm-problem-gutter',
    markers: view => view.state.field(problems),
    initialSpacer: () => new ProblemMarker('error', ''),
    domEventHandlers: {
      mousedown(view, line) {
        let marked = false;
        view.state.field(problems).between(line.from, line.from, () => { marked = true; });
        if (!marked || !onSelect) return false;
        onSelect();
        return true;
      },
    },
  }),
  EditorView.baseTheme({
    '.cm-problem-gutter .cm-gutterElement': { padding: '0 0 0 6px' },
    // Inline, so a wrapped line keeps its mark beside the first row of text.
    '.cm-problem': { display: 'inline-block', verticalAlign: 'middle', width: '7px', height: '7px', borderRadius: '50%', cursor: 'pointer' },
    '.cm-problem-error': { background: 'var(--error)' },
    '.cm-problem-warning': { background: 'var(--warning)' },
  }),
];
