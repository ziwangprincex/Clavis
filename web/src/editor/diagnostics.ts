// Compile problems in the editor margin, as Texifier marks errors beside the
// line. Markers follow the text while it is edited and are replaced by the next
// compile's results. Clicking one opens its messages beside the line, as
// Texifier's issue popover does; from there the full problem list is one click.

import { RangeSet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, GutterMarker, gutter, keymap, showTooltip, type Tooltip } from '@codemirror/view';
import { t } from '../i18n';

export interface LineProblem { line: number; severity: 'error' | 'warning'; message: string }

class ProblemMarker extends GutterMarker {
  constructor(readonly severity: LineProblem['severity'], readonly messages: readonly string[]) { super(); }
  eq(other: ProblemMarker) {
    return other.severity === this.severity && other.messages.join('\0') === this.messages.join('\0');
  }
  toDOM() {
    const dom = document.createElement('span');
    dom.className = `cm-problem cm-problem-${this.severity}`;
    const label = this.messages.join('\n');
    dom.title = label;
    dom.setAttribute('aria-label', label);
    return dom;
  }
}

/** Line numbers of marked lines carry the severity too (the gutter colours their numbers). */
class LineNumberMarker extends GutterMarker {
  constructor(readonly severity: LineProblem['severity']) {
    super();
    this.elementClass = `cm-line-problem cm-line-problem-${severity}`;
  }
  eq(other: LineNumberMarker) { return other.severity === this.severity; }
}

export const setProblems = StateEffect.define<LineProblem[]>();

/** One marker per line: an error outranks warnings; messages of the shown severity are listed. */
function markers(problems: LineProblem[], doc: { lines: number; line(n: number): { from: number } }) {
  const byLine = new Map<number, { severity: LineProblem['severity']; messages: string[] }>();
  for (const problem of problems) {
    if (problem.line < 1 || problem.line > doc.lines) continue;
    const seen = byLine.get(problem.line);
    if (!seen || (seen.severity === 'warning' && problem.severity === 'error')) {
      byLine.set(problem.line, { severity: problem.severity, messages: [problem.message] });
    } else if (seen.severity === problem.severity && !seen.messages.includes(problem.message)) {
      seen.messages.push(problem.message);
    }
  }
  return RangeSet.of([...byLine.entries()].sort(([a], [b]) => a - b)
    .map(([line, { severity, messages }]) => new ProblemMarker(severity, messages).range(doc.line(line).from)));
}

export const problems = StateField.define<RangeSet<ProblemMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setProblems)) next = markers(effect.value, tr.state.doc);
    return next;
  },
});

/** The marker at the start of the line at `pos`, if that line has one. */
function markerAt(set: RangeSet<ProblemMarker>, pos: number): { from: number; marker: ProblemMarker } | null {
  let found: { from: number; marker: ProblemMarker } | null = null;
  set.between(pos, pos, (from, _to, marker) => { found = { from, marker }; });
  return found;
}

/** Shows the messages of the marked line starting at a position, or closes them (null). */
export const openProblem = StateEffect.define<number | null>();

/** The line whose messages are shown, by its start. Any edit, cursor move or new compile closes it. */
const shownProblem = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(openProblem)) return effect.value;
    if (value === null) return null;
    if (tr.docChanged || tr.selection || tr.effects.some(effect => effect.is(setProblems))) return null;
    return value;
  },
});

function problemTooltip(onSelect?: () => void) {
  return showTooltip.compute([shownProblem, problems], (state): Tooltip | null => {
    const at = state.field(shownProblem);
    const found = at === null ? null : markerAt(state.field(problems), at);
    if (!found) return null;
    return {
      pos: found.from,
      above: false,
      create(view) {
        const dom = document.createElement('div');
        dom.className = `cm-problem-popover cm-problem-popover-${found.marker.severity}`;
        const list = document.createElement('ul');
        for (const message of found.marker.messages) {
          const item = document.createElement('li');
          item.textContent = message;
          list.append(item);
        }
        dom.append(list);
        if (onSelect) {
          const all = document.createElement('button');
          all.type = 'button';
          all.className = 'cm-problem-popover-all';
          all.textContent = t('All problems…');
          all.addEventListener('mousedown', event => event.preventDefault());
          all.addEventListener('click', () => {
            view.dispatch({ effects: openProblem.of(null) });
            onSelect();
          });
          dom.append(all);
        }
        return { dom };
      },
    };
  });
}

/** `onSelect` opens the full problem list (the popover's last row). */
export const problemGutter = (onSelect?: () => void): Extension => [
  problems,
  shownProblem,
  problemTooltip(onSelect),
  gutter({
    class: 'cm-problem-gutter',
    markers: view => view.state.field(problems),
    initialSpacer: () => new ProblemMarker('error', []),
    domEventHandlers: {
      mousedown(view, line) {
        const found = markerAt(view.state.field(problems), line.from);
        if (!found) return false;
        const shown = view.state.field(shownProblem);
        view.dispatch({ effects: openProblem.of(shown === found.from ? null : found.from) });
        return true;
      },
    },
  }),
  keymap.of([{
    key: 'Escape',
    run: view => {
      if (view.state.field(shownProblem) === null) return false;
      view.dispatch({ effects: openProblem.of(null) });
      return true;
    },
  }]),
  EditorView.baseTheme({
    '.cm-problem-gutter .cm-gutterElement': { padding: '0 0 0 6px' },
    // Inline, so a wrapped line keeps its mark beside the first row of text.
    '.cm-problem': { display: 'inline-block', verticalAlign: 'middle', width: '7px', height: '7px', borderRadius: '50%', cursor: 'pointer' },
    '.cm-problem-error': { background: 'var(--error)' },
    '.cm-problem-warning': { background: 'var(--warning)' },
    '.cm-tooltip.cm-problem-popover': {
      maxWidth: 'min(520px, 80vw)',
      padding: '6px 10px 6px 12px',
      borderLeft: '3px solid var(--error)',
      borderRadius: '6px',
      font: '12.5px/1.45 var(--ui-font, system-ui)',
      boxShadow: '0 6px 20px rgb(0 0 0 / 14%)',
    },
    '.cm-tooltip.cm-problem-popover-warning': { borderLeftColor: 'var(--warning)' },
    '.cm-problem-popover ul': { margin: 0, padding: 0, listStyle: 'none' },
    '.cm-problem-popover li': { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
    '.cm-problem-popover li + li': { marginTop: '4px', paddingTop: '4px', borderTop: '1px solid var(--border)' },
    '.cm-problem-popover-all': {
      marginTop: '6px', padding: 0, border: 0, background: 'none', color: 'var(--accent)', font: 'inherit', cursor: 'pointer',
    },
  }),
];

/** Error and warning lines, for the line-number gutter (Texifier marks the number itself). */
export const problemLineNumbers = (state: EditorState): RangeSet<GutterMarker> => {
  const set = state.field(problems, false);
  if (!set) return RangeSet.empty;
  const ranges = [];
  for (const cursor = set.iter(); cursor.value; cursor.next()) ranges.push(new LineNumberMarker(cursor.value.severity).range(cursor.from));
  return RangeSet.of(ranges);
};
