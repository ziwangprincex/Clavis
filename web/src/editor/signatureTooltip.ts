// Parameter signature tooltip: a floating panel listing the enclosing call's
// parameters, with the active one highlighted.
//
// This is LSP `signatureHelp`, not completion. Typst's own `typst-ide` crate has
// no signature-help API — its public surface is completion, hover tooltips and
// jumps — so the panel is assembled from parameter metadata here.
//
// Positioning notes, both verified against the installed CodeMirror:
//
//   * `@codemirror/autocomplete` publishes its popup through the same
//     `showTooltip` facet, so the two would collide at one position. `above:
//     true` puts the signature over the cursor and leaves the completion list
//     below it.
//   * The editor host sets `overflow: hidden` (`EditorPane.module.css`), which
//     would clip an absolutely-positioned panel. CodeMirror's tooltips default
//     to `position: fixed`, escaping that container, so no config is needed.

import { StateField } from '@codemirror/state';
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view';
import type { Lang } from '../store';
import { detectCallSite } from '../completions/callSite';
import { signatureFor, type Signature } from '../completions/signatures';
import { withAlpha, type ThemeSpec } from './controller';

/** Render one parameter as `name: type`, marking variadics and defaults. */
function paramLabel(param: Signature['params'][number]): string {
  const name = param.variadic ? `..${param.name}` : param.name;
  if (!param.type) return name;
  // `#let` defaults arrive pre-formatted as `= expr`; types get a colon.
  return param.type.startsWith('=') ? `${name} ${param.type}` : `${name}: ${param.type}`;
}

function renderSignature(signature: Signature): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-signature-tooltip';

  const header = document.createElement('div');
  header.className = 'cm-signature-name';
  header.textContent = signature.name;
  if (signature.returns) {
    const ret = document.createElement('span');
    ret.className = 'cm-signature-returns';
    ret.textContent = ` → ${signature.returns}`;
    header.appendChild(ret);
  }
  if (signature.userDefined) {
    const tag = document.createElement('span');
    tag.className = 'cm-signature-tag';
    // Worth stating plainly: a closure's types are not introspectable, so their
    // absence here is a limitation rather than missing data.
    tag.textContent = ' (local)';
    header.appendChild(tag);
  }
  dom.appendChild(header);

  const list = document.createElement('div');
  list.className = 'cm-signature-params';
  signature.params.forEach((param, i) => {
    const row = document.createElement('div');
    row.className = i === signature.activeIndex
      ? 'cm-signature-param cm-signature-param-active'
      : 'cm-signature-param';
    const label = document.createElement('span');
    label.className = 'cm-signature-param-name';
    label.textContent = paramLabel(param);
    row.appendChild(label);
    if (param.required) {
      const req = document.createElement('span');
      req.className = 'cm-signature-required';
      req.textContent = ' *';
      row.appendChild(req);
    }
    // Only the active parameter shows its docs: one line each for a dozen
    // parameters would cover the text being edited.
    if (i === signature.activeIndex && param.docs) {
      const docs = document.createElement('div');
      docs.className = 'cm-signature-docs';
      docs.textContent = param.docs;
      row.appendChild(docs);
    }
    list.appendChild(row);
  });
  dom.appendChild(list);
  return dom;
}

/**
 * Build the tooltip for the current cursor, or null when the cursor is not in a
 * call whose signature we know.
 */
function signatureTooltip(state: EditorView['state'], language: Lang): Tooltip | null {
  const range = state.selection.main;
  // A selection is a range edit, not a call being written; showing a panel then
  // is noise.
  if (!range.empty) return null;

  const text = state.doc.toString();
  const site = detectCallSite(text, range.head, language);
  if (!site) return null;
  const signature = signatureFor(text, site, language);
  if (!signature || signature.params.length === 0) return null;

  return {
    pos: range.head,
    above: true,
    create: () => ({ dom: renderSignature(signature) }),
  };
}

/**
 * Extension showing a parameter panel while the cursor is inside a call.
 *
 * Recomputed on document and selection changes only — the panel is derived
 * state, and rebuilding it on unrelated transactions would thrash the DOM.
 */
export function signatureTooltipExt(language: Lang) {
  const field = StateField.define<Tooltip | null>({
    create: state => signatureTooltip(state, language),
    update(current, tr) {
      if (!tr.docChanged && !tr.selection) return current;
      return signatureTooltip(tr.state, language);
    },
    provide: f => showTooltip.from(f),
  });
  return field;
}

/** Theme-matched styling for the panel. Rebuilt whenever the editor theme does. */
export function signatureTheme(spec: ThemeSpec) {
  return EditorView.theme({
    '.cm-signature-tooltip': {
      padding: '6px 8px',
      maxWidth: '520px',
      backgroundColor: spec.activeBg,
      color: spec.fg,
      border: `1px solid ${withAlpha(spec.accent, 0.4)}`,
      borderRadius: '4px',
      fontSize: '12px',
      lineHeight: '1.5',
    },
    '.cm-signature-name': {
      fontWeight: '600',
      color: spec.accent,
      marginBottom: '3px',
    },
    '.cm-signature-returns': { fontWeight: '400', opacity: '0.75' },
    '.cm-signature-tag': { fontWeight: '400', opacity: '0.6', fontStyle: 'italic' },
    '.cm-signature-params': { display: 'flex', flexDirection: 'column' },
    '.cm-signature-param': { opacity: '0.6', padding: '0 2px' },
    '.cm-signature-param-active': {
      opacity: '1',
      backgroundColor: withAlpha(spec.accent, 0.16),
      borderRadius: '2px',
    },
    '.cm-signature-param-name': { fontFamily: 'inherit' },
    '.cm-signature-required': { color: spec.accent, fontWeight: '600' },
    '.cm-signature-docs': {
      opacity: '0.8',
      fontSize: '11px',
      paddingLeft: '10px',
      whiteSpace: 'normal',
    },
  });
}
