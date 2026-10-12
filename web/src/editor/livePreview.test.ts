import { describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorView, showTooltip, type DecorationSet } from '@codemirror/view';
import { inlineDecorations, markdownFocus, markdownLivePreview, type LivePreviewHost } from './livePreview';
import { markdownLanguage } from './controller';
import { markdownInline } from '../render/markdown';

vi.mock('../api/tauri', () => ({ ipc: {} }));

const host: LivePreviewHost = { imageSrc: async () => null, openLink: () => {}, pasteImage: async () => null };
// The editor's own parser, front matter and fenced languages included.
const language = markdownLanguage();

/** A focused editor unless `focused` is false. */
function stateOf(doc: string, cursor = doc.length, focused = true) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [language, markdownLivePreview(host)],
  }).update({ effects: markdownFocus.of(focused) }).state;
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

function nodes(doc: string): string[] {
  const out: string[] = [];
  syntaxTree(stateOf(doc)).iterate({ enter: node => { out.push(node.name); } });
  return out;
}

type Seen = { from: number; to: number; text: string; widget?: string; line?: string; style?: string };
function collect(set: DecorationSet, state: EditorState): Seen[] {
  const out: Seen[] = [];
  set.between(0, state.doc.length, (from, to, deco) => {
    const spec = deco.spec as { widget?: object; class?: string; attributes?: { style?: string } };
    out.push({
      from, to, text: state.sliceDoc(from, to),
      widget: spec.widget?.constructor.name,
      line: from === to && !spec.widget ? spec.class : undefined,
      style: spec.attributes?.style,
    });
  });
  return out;
}
const inline = (state: EditorState) =>
  collect(inlineDecorations({ state, visibleRanges: [{ from: 0, to: state.doc.length }] }, host), state);
const blocks = (state: EditorState) => state.facet(EditorView.decorations)
  .flatMap(source => typeof source === 'function' ? [] : collect(source, state));
const hidden = (seen: Seen[]) => seen.filter(item => item.from < item.to && !item.widget && !item.line).map(item => item.text);

describe('markdown math syntax', () => {
  it('parses formulas as math, so emphasis inside them is not markup', () => {
    expect(nodes('text $a*b*c$ end')).toContain('InlineMath');
    expect(nodes('text $a*b*c$ end')).not.toContain('Emphasis');
    expect(nodes('$$\nx^2\n$$\n')).toContain('DisplayMath');
    expect(nodes('$$x$$ inline display')).toContain('InlineMath');
  });

  it('follows the preview tokenizer for prices and escapes', () => {
    expect(nodes('costs $5 and $6 today')).not.toContain('InlineMath');
    expect(nodes('escaped \\$x$ here')).not.toContain('InlineMath');
  });
});

describe('formatted markdown', () => {
  const doc = '# Title\n\nSome **bold** and `code` and [link](https://x.org).\n\n- [x] done\n- item\n  - nested\n';

  it('reveals nothing while the editor is unfocused, so a document opens formatted', () => {
    const atTitle = (focused: boolean) => hidden(inline(stateOf(doc, 0, focused)));
    expect(atTitle(true)).not.toContain('# ');
    expect(atTitle(false)).toContain('# ');
    const table = '| a |\n|---|\n| b |\n';
    expect(blocks(stateOf(table, 0, false)).map(item => item.widget)).toContain('TableWidget');
    expect(blocks(stateOf(table, 0, true)).map(item => item.widget)).not.toContain('TableWidget');
  });

  it('hides marks away from the cursor and styles the lines they belong to', () => {
    const seen = inline(stateOf(doc, doc.length));
    expect(hidden(seen)).toEqual(expect.arrayContaining(['# ', '**', '`', '[', '](https://x.org)']));
    expect(seen.find(item => item.line?.includes('cm-md-h1'))?.from).toBe(0);
    expect(seen.filter(item => item.widget === 'BulletWidget').map(item => item.text)).toEqual(['- [x] ', '- ', '  - ']);
    expect(seen.find(item => item.text === 'link')?.from).toBe(doc.indexOf('link]'));
  });

  it('reveals source where the selection is, without changing line styles', () => {
    const bold = doc.indexOf('bold');
    const seen = inline(stateOf(doc, bold));
    expect(hidden(seen)).not.toContain('**');
    expect(hidden(seen)).toContain('# ');
    expect(seen.find(item => item.line?.includes('cm-md-h1'))).toBeDefined();
  });

  it('keeps block marks hidden while their text is edited, as Typora does', () => {
    expect(hidden(inline(stateOf(doc, doc.indexOf('Title') + 2)))).toContain('# ');
    expect(hidden(inline(stateOf(doc, 0)))).not.toContain('# ');
    const quote = '> quoted text\n';
    expect(hidden(inline(stateOf(quote, quote.indexOf('text'))))).toContain('> ');
  });

  it('draws front matter as a quiet block with its fences hidden', () => {
    const meta = '---\ntitle: Draft\n---\n\nBody\n';
    const seen = inline(stateOf(meta, meta.length));
    // The fences are replaced by empty labels that keep their lines' height.
    expect(seen.filter(item => item.widget === 'FenceWidget').map(item => item.text)).toEqual(['---', '---']);
    expect(seen.filter(item => item.line?.includes('cm-md-frontmatter'))).toHaveLength(3);
  });

  it('draws ==highlight==, ^sup^ and ~sub~ without catching CJK ranges', () => {
    const text = 'A ==key== term, H~2~O and x^2^, ~~gone~~, 1~3天，5~7天, 2^10 and 3^4.\n';
    const names = nodes(text);
    expect(names.filter(name => name === 'Highlight')).toHaveLength(1);
    expect(names.filter(name => name === 'Subscript')).toHaveLength(1);
    expect(names.filter(name => name === 'Superscript')).toHaveLength(1);
    expect(names).toContain('Strikethrough');
    const seen = inline(stateOf(text, text.length));
    expect(seen.find(item => item.text === 'key')).toBeDefined();
    expect(hidden(seen)).toEqual(expect.arrayContaining(['==', '~', '^', '~~']));
    expect(markdownInline('==a== H~2~O x^2^ 1~3天，5~7天')).toBe('<mark>a</mark> H<sub>2</sub>O x<sup>2</sup> 1~3天，5~7天');
  });

  it('draws GitHub alerts as callouts with a label', () => {
    const doc = '> [!WARNING]\n> Back up first.\n\n> [!nope]\n> plain\n';
    const seen = inline(stateOf(doc, doc.length));
    expect(seen.filter(item => item.line?.includes('cm-md-callout-warning'))).toHaveLength(2);
    expect(seen.find(item => item.widget === 'CalloutLabelWidget')?.text).toBe('[!WARNING]');
    expect(seen.some(item => item.line?.includes('cm-md-callout') && item.from >= doc.indexOf('[!nope]') - 2)).toBe(false);
  });

  it('raises footnote references and mutes their definitions', () => {
    const notes = 'A claim[^1] and [^wide] here.\n\n[^1]: The **source**.\n';
    expect(nodes(notes).filter(name => name === 'FootnoteReference')).toHaveLength(2);
    expect(nodes(notes)).not.toContain('Link');
    const seen = inline(stateOf(notes, notes.length));
    expect(hidden(seen)).toEqual(expect.arrayContaining(['[^', ']', '**']));
    expect(seen.filter(item => item.text === '1' || item.text === 'wide').length).toBeGreaterThanOrEqual(2);
    expect(seen.find(item => item.line?.includes('cm-md-footnote'))?.from).toBe(notes.indexOf('[^1]:'));
  });

  it('offers the table toolbar only while a table is being edited', () => {
    const doc = 'Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
    const tips = (state: EditorState) => state.facet(showTooltip).filter(Boolean);
    expect(tips(stateOf(doc, doc.indexOf('| 1')))).toHaveLength(1);
    expect(tips(stateOf(doc, doc.indexOf('| 1')))[0]!.pos).toBe(doc.indexOf('| a'));
    expect(tips(stateOf(doc, 0))).toHaveLength(0);
    expect(tips(stateOf(doc, doc.indexOf('| 1'), false))).toHaveLength(0);
  });

  it('draws mermaid fences as diagrams, and under their source while edited', () => {
    const doc = 'Intro\n\n```mermaid\ngraph TD; A-->B\n```\n\n```python\nx = 1\n```\n';
    expect(blocks(stateOf(doc, 0)).map(item => item.widget)).toEqual(['DiagramWidget']);
    expect(blocks(stateOf(doc, doc.indexOf('A-->B'))).map(item => item.widget)).toEqual(['DiagramWidget']);
    const preview = stateOf(doc, doc.indexOf('A-->B')).facet(EditorView.decorations)
      .flatMap(source => typeof source === 'function' ? [] : [source])[0];
    let isPreview = false;
    preview.between(0, doc.length, (_from, _to, deco) => { isPreview = (deco.spec.widget as { preview: boolean }).preview; });
    expect(isPreview).toBe(true);
    // Still being typed: no closing fence, no diagram.
    expect(blocks(stateOf('```mermaid\ngraph TD; A-->B\n', 0))).toEqual([]);
  });

  it('previews a display formula under its source while it is edited', () => {
    const math = 'Text\n\n$$\nx^2\n$$\n';
    expect(blocks(stateOf(math, math.indexOf('x^2'))).map(item => item.widget)).toEqual(['MathPreviewWidget']);
    expect(blocks(stateOf(math, 0)).map(item => item.widget)).toEqual(['MathWidget']);
    const unfinished = 'Text\n\n$$\n\\frac{\n$$\n';
    expect(blocks(stateOf(unfinished, unfinished.indexOf('frac'))).map(item => item.widget)).toEqual(['MathPreviewWidget']);
  });

  it('indents nested list items and keeps checked tasks muted', () => {
    const seen = inline(stateOf(doc, 0));
    const nested = doc.indexOf('  - nested');
    expect(seen.find(item => item.from === nested && item.style)?.style).toContain('3.2em');
    expect(seen.find(item => item.line?.includes('cm-md-task-done'))?.from).toBe(doc.indexOf('- [x]'));
  });

  it('draws tables and display math as blocks only while the cursor is elsewhere', () => {
    const source = 'Intro\n\n| a | b |\n|:--|--:|\n| 1 | **2** |\n\n$$\nx^2\n$$\n';
    expect(blocks(stateOf(source, 0)).map(item => item.widget)).toEqual(['TableWidget', 'MathWidget']);
    const inTable = blocks(stateOf(source, source.indexOf('| 1')));
    expect(inTable.map(item => item.widget)).toEqual(['MathWidget']);
  });

  it('renders table cells with alignment and source offsets for click-to-edit', () => {
    const source = '| a | b |\n|:--|--:|\n| 1 | **2** |\n\nafter';
    const table = stateOf(source, source.length).facet(EditorView.decorations)
      .flatMap(item => typeof item === 'function' ? [] : [item])[0];
    let html = '';
    table.between(0, source.length, (_from, _to, deco) => {
      html = (deco.spec.widget as { html: string }).html;
    });
    expect(html).toContain('<th data-offset="2" style="text-align:left">a</th>');
    expect(html).toContain('style="text-align:right"');
    expect(html).toContain(`data-offset="${source.indexOf('**2**')}"`);
    expect(html).toContain('<strong>2</strong>');
  });
});

describe('review fixes', () => {
  const blockWidgets = (state: EditorState) => {
    const out: object[] = [];
    for (const source of state.facet(EditorView.decorations)) {
      if (typeof source === 'function') continue;
      source.between(0, state.doc.length, (_from, _to, deco) => { if (deco.spec.widget) out.push(deco.spec.widget); });
    }
    return out as Array<{ html?: string }>;
  };

  it('leaves bracketed text without a destination as plain text', () => {
    const doc = 'See [1] and [sic] here.\n';
    expect(hidden(inline(stateOf(doc, doc.length)))).toEqual([]);
  });

  it('strips angle brackets from destinations with spaces', () => {
    const doc = 'x\n\n![](<my fig.png>)\n';
    const image = inline(stateOf(doc, 0)).find(item => item.widget === 'ImageWidget');
    expect(image).toBeDefined();
    const deco = inlineDecorations({ state: stateOf(doc, 0), visibleRanges: [{ from: 0, to: doc.length }] }, host);
    let href = '';
    deco.between(0, doc.length, (_f, _t, value) => { const w = value.spec.widget as { href?: string } | undefined; if (w?.href) href = w.href; });
    expect(href).toBe('my fig.png');
  });

  it('renders quoted display math without the quote markers', () => {
    const doc = 'x\n\n> $$\n> x = 1\n> $$\n';
    const [math] = blockWidgets(stateOf(doc, 0));
    expect(math?.html).toContain('x = 1</annotation>');
    expect(math?.html).not.toContain('&gt;');
  });

  it('keeps fence lines compact while the code block is being edited', () => {
    const doc = '```js\ncode\n```\n';
    const editing = inline(stateOf(doc, doc.indexOf('code')));
    expect(editing.filter(item => item.line?.includes('cm-md-fence')).length).toBe(2);
  });

  it('reuses rendered blocks when text elsewhere changes', () => {
    const doc = 'Intro\n\n$$\nx^2\n$$\n\n| a |\n|---|\n| 1 |\n';
    const before = stateOf(doc, 0);
    const after = before.update({ changes: { from: 0, insert: 'More ' } }).state;
    ensureSyntaxTree(after, after.doc.length, 5000);
    const [mathBefore, tableBefore] = blockWidgets(before);
    const [mathAfter, tableAfter] = blockWidgets(after);
    expect(mathAfter).toBe(mathBefore);
    expect(tableAfter).toBe(tableBefore);
  });
});
