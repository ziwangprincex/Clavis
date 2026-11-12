// How formatted Markdown looks: headings, lists, quotes, code, math, tables,
// callouts and the table toolbar. Colors and fonts come from the app's tokens.

import { EditorView } from '@codemirror/view';

export const livePreviewTheme = EditorView.baseTheme({
  // Text, quote bars, code backgrounds, rules and tables share one left edge.
  '.cm-line': { paddingInline: '0' },
  // A heading sits closer to what it introduces than to what came before, and
  // its tracking and leading tighten as it grows.
  '.cm-line.cm-md-h1, .cm-line.cm-md-h2, .cm-line.cm-md-h3, .cm-line.cm-md-h4, .cm-line.cm-md-h5, .cm-line.cm-md-h6': {
    lineHeight: '1.3', paddingTop: '0.8em', paddingBottom: '0.2em',
  },
  // Serif headings keep their natural spacing; negative tracking suits sans display type.
  '.cm-line.cm-md-h1': { lineHeight: '1.25', paddingTop: '0.4em', paddingBottom: '0.45em' },
  '.cm-line.cm-md-h2': { lineHeight: '1.3', paddingTop: '1.1em' },
  '.cm-md-h1': { fontSize: 'var(--h1-size, 2em)', fontWeight: 'var(--h1-weight, 600)', fontFamily: 'var(--h1-font, inherit)' },
  '.cm-md-h2': { fontSize: 'var(--h2-size, 1.5em)', fontWeight: 'var(--h2-weight, 600)', fontFamily: 'var(--h2-font, inherit)' },
  '.cm-md-h3': { fontSize: 'var(--h3-size, 1.2em)', fontWeight: 'var(--h3-weight, 600)', fontFamily: 'var(--h3-font, inherit)' },
  '.cm-md-h4': { fontSize: 'var(--h4-size, 1em)', fontWeight: 'var(--h4-weight, 600)', fontFamily: 'var(--h4-font, inherit)' },
  '.cm-md-h5': { fontSize: 'var(--h5-size, 1em)', fontWeight: 'var(--h5-weight, 600)', fontFamily: 'var(--h5-font, inherit)' },
  '.cm-md-h6': { fontSize: 'var(--h6-size, 1em)', fontWeight: 'var(--h6-weight, 600)', fontFamily: 'var(--h6-font, inherit)' },
  '.cm-line.cm-md-setext': { fontSize: '0.5em', lineHeight: '1' },
  '.cm-line.cm-md-quote': {
    borderLeft: '2px solid var(--border-strong)', paddingLeft: '1.1em',
    color: 'var(--text-muted)', fontFamily: 'var(--quote-font, inherit)', fontStyle: 'var(--quote-style, normal)',
  },
  '.cm-line.cm-md-code': {
    fontFamily: 'var(--code-font, var(--font-mono))', fontSize: '0.88em', lineHeight: '1.6',
    background: 'var(--panel-soft)', paddingInline: '1em',
  },
  '.cm-line.cm-md-code-first': { borderTopLeftRadius: '6px', borderTopRightRadius: '6px', paddingTop: '0.5em' },
  '.cm-line.cm-md-code-last': { borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', paddingBottom: '0.5em' },
  '.cm-line.cm-md-fence': { lineHeight: '1.2', fontSize: '0.72em' },
  '.cm-line.cm-md-fence-label-line': { textAlign: 'right' },
  '.cm-md-fence-label': { color: 'var(--text-dim)', fontFamily: 'var(--font-sans)', letterSpacing: '0.02em' },
  // Tables and formulas being edited: their source in a quiet box, as Typora's input fields.
  // Ligatures would turn a table's `--` delimiters into dashes.
  '.cm-line.cm-md-source-block': {
    fontFamily: 'var(--code-font, var(--font-mono))', fontSize: '0.88em', fontVariantLigatures: 'none',
    background: 'var(--panel-soft)', paddingInline: '0.75em',
  },
  '.cm-line.cm-md-source-first': { borderTopLeftRadius: '6px', borderTopRightRadius: '6px' },
  '.cm-line.cm-md-source-last': { borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px' },
  '.cm-md-inline-code': {
    fontFamily: 'var(--inline-code-font, var(--font-mono))', fontSize: '0.88em',
    background: 'var(--panel-soft)', borderRadius: '4px', padding: '0.1em 0.3em',
  },
  '.cm-md-link': {
    color: 'var(--accent)', textDecoration: 'underline', textDecorationThickness: '1px', textUnderlineOffset: '3px',
  },
  '.cm-md-bullet': {
    display: 'inline-block', boxSizing: 'border-box', paddingRight: '0.5em', textAlign: 'right',
    textIndent: '0', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums',
  },
  '.cm-md-task': {
    display: 'inline-block', boxSizing: 'border-box', width: '0.82em', height: '0.82em', verticalAlign: '-0.06em',
    border: '1.5px solid var(--text-dim)', borderRadius: '0.22em', cursor: 'pointer',
  },
  '.cm-md-task[aria-checked=true]': { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--bg)' },
  '.cm-md-task svg': {
    display: 'block', width: '100%', height: '100%',
    fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round',
  },
  '.cm-line.cm-md-task-done': { color: 'var(--text-muted)' },
  '.cm-md-rule': {
    display: 'inline-block', width: '100%', height: '0', verticalAlign: 'middle',
    borderTop: '1px solid var(--border-strong)',
  },
  '.cm-md-math': { cursor: 'text' },
  '.cm-md-math-block': { padding: '0.6em 0', textAlign: 'center', overflowX: 'auto', cursor: 'text' },
  '.cm-md-math-preview': {
    padding: '0.6em 0', textAlign: 'center', overflowX: 'auto',
    borderBottom: '1px solid var(--border)', marginBottom: '0.3em',
  },
  '.cm-md-math-pending': { color: 'var(--text-dim)', fontSize: '0.85em' },
  '.cm-md-diagram': { padding: '0.6em 0', textAlign: 'center', overflowX: 'auto', cursor: 'text', color: 'var(--text-dim)', fontSize: '0.85em' },
  '.cm-md-diagram svg': { maxWidth: '100%', height: 'auto' },
  '.cm-md-diagram-preview': { borderBottom: '1px solid var(--border)', marginBottom: '0.3em', cursor: 'default' },
  '.cm-md-diagram-error': { color: 'var(--error)', textAlign: 'left' },
  '.cm-md-diagram-pending': { opacity: '0.55' },
  '.cm-line.cm-md-frontmatter': { color: 'var(--text-muted)' },
  // Callouts read in full text colour, the bar and label in the kind's colour.
  '.cm-line.cm-md-callout': { color: 'var(--text)' },
  '.cm-line.cm-md-callout-note, .cm-line.cm-md-callout-important': { borderLeftColor: 'var(--accent)' },
  '.cm-line.cm-md-callout-tip': { borderLeftColor: 'var(--ok)' },
  '.cm-line.cm-md-callout-warning': { borderLeftColor: 'var(--warning)' },
  '.cm-line.cm-md-callout-caution': { borderLeftColor: 'var(--error)' },
  '.cm-md-callout-label': { fontWeight: '600' },
  '.cm-md-callout-note .cm-md-callout-label, .cm-md-callout-important .cm-md-callout-label': { color: 'var(--accent)' },
  '.cm-md-callout-tip .cm-md-callout-label': { color: 'var(--ok)' },
  '.cm-md-callout-warning .cm-md-callout-label': { color: 'var(--warning)' },
  '.cm-md-callout-caution .cm-md-callout-label': { color: 'var(--error)' },
  '.cm-md-highlight': { background: 'color-mix(in srgb, var(--warning) 30%, transparent)', borderRadius: '2px', padding: '0.05em 0' },
  // Raised and lowered without growing the line, so the paragraph keeps its rhythm.
  '.cm-md-sup': { fontSize: '0.75em', verticalAlign: 'super', lineHeight: '0' },
  '.cm-md-sub': { fontSize: '0.75em', verticalAlign: 'sub', lineHeight: '0' },
  '.cm-md-table mark': { background: 'color-mix(in srgb, var(--warning) 30%, transparent)', color: 'inherit' },
  '.cm-md-footnote-ref': { fontSize: '0.72em', verticalAlign: 'super', lineHeight: '0', color: 'var(--accent)', padding: '0 0.1em' },
  '.cm-line.cm-md-footnote': { fontSize: '0.9em', color: 'var(--text-muted)' },
  '.cm-md-footnote-label': { color: 'var(--text-dim)' },
  '.cm-md-image img': { maxHeight: '1.5em', verticalAlign: 'middle' },
  // An image alone in its paragraph is centred, as Typora does.
  '.cm-md-image-block img': { display: 'block', maxWidth: '100%', maxHeight: 'none', margin: '0.4em auto', borderRadius: '4px' },
  '.cm-md-image-block.cm-md-image-missing': { display: 'block', textAlign: 'center' },
  '.cm-md-image-missing': { color: 'var(--text-muted)', fontSize: '0.9em', fontStyle: 'italic' },
  '.cm-md-table': { overflowX: 'auto', padding: '0.4em 0', cursor: 'text' },
  '.cm-md-table-tools': { position: 'relative', display: 'flex', alignItems: 'center', gap: '1px', padding: '3px', fontFamily: 'var(--font-sans)' },
  '.cm-md-table-tools button': {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '24px',
    padding: '0', border: 'none', borderRadius: '5px', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
  },
  '.cm-md-table-tools button:hover': { background: 'var(--panel-soft)', color: 'var(--text)' },
  '.cm-md-table-tools button[aria-pressed=true]': { background: 'var(--tint-accent)', color: 'var(--accent)' },
  '.cm-md-table-tools-gap': { width: '1px', height: '16px', margin: '0 4px', background: 'var(--border)' },
  '.cm-tooltip:has(> .cm-md-table-tools)': { overflow: 'visible' },
  '.cm-md-table-tools button.cm-md-table-tools-menu': { width: '34px', gap: '2px' },
  '.cm-md-table-tools button[aria-expanded=true]': { background: 'var(--panel-soft)', color: 'var(--text)' },
  '.cm-md-table-menu': {
    position: 'absolute', top: 'calc(100% + 4px)', zIndex: '10', minWidth: '210px', padding: '4px',
    display: 'flex', flexDirection: 'column', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: '8px', boxShadow: 'var(--shadow-md)',
  },
  '.cm-md-table-menu button': {
    display: 'flex', justifyContent: 'space-between', gap: '18px', width: '100%', height: 'auto', padding: '5px 9px',
    borderRadius: '5px', color: 'var(--text)', font: '13px/1.4 var(--font-sans)', textAlign: 'left',
  },
  '.cm-md-table-menu button:hover': { background: 'var(--tint-accent)' },
  '.cm-md-table-menu kbd': { font: 'inherit', color: 'var(--text-muted)' },
  // Three rules, as booktabs sets a table: a heavier rule above and below,
  // a light one under the header, none between rows.
  '.cm-md-table table': {
    borderCollapse: 'collapse', fontSize: '0.94em', lineHeight: '1.5',
    fontVariantNumeric: 'lining-nums tabular-nums',
    borderTop: '1.5px solid var(--text)', borderBottom: '1.5px solid var(--text)',
  },
  '.cm-md-table th, .cm-md-table td': { padding: '0.3em 1.1em', textAlign: 'left' },
  // The outer cells sit on the text edges.
  '.cm-md-table th:first-child, .cm-md-table td:first-child': { paddingLeft: '0' },
  '.cm-md-table th:last-child, .cm-md-table td:last-child': { paddingRight: '0' },
  '.cm-md-table th': { fontWeight: '600', paddingTop: '0.45em', borderBottom: '0.75px solid var(--text)' },
  '.cm-md-table tbody tr:first-child td': { paddingTop: '0.55em' },
  '.cm-md-table tbody tr:last-child td': { paddingBottom: '0.55em' },
  '.cm-md-table code': { fontFamily: 'var(--inline-code-font, var(--font-mono))', fontSize: '0.9em' },
});
