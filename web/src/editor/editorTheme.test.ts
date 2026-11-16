// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { openSearchPanel, SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorController } from './controller';
import { livePreviewTheme } from './livePreviewTheme';
import { BUILTIN_THEMES } from '../theme/themes';

let controller: EditorController | null = null;
afterEach(() => { controller?.destroy(); controller = null; });

/** Every injected CodeMirror rule whose selector ends with `selector`, as "selector { declarations }". */
function rulesFor(selector: string): string[] {
  const css = [...document.querySelectorAll('style')].map(style => style.textContent ?? '').join('\n');
  const rules = css.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  return rules.map(rule => rule.trim()).filter(rule => rule.split('{')[0].trim().split(',').some(part => part.trim().endsWith(selector)));
}

describe('editor theme', () => {
  function mountEditor() {
    const parent = document.createElement('div');
    document.body.append(parent);
    controller = new EditorController({
      parent,
      initialDoc: '```js\ncode\n```\n',
      lang: 'markdown',
      font: { family: 'serif', size: 16, lineHeight: 1.6 },
      theme: BUILTIN_THEMES.paper,
      spellcheck: false,
    });
  }

  it('sets the placeholder and the code block label on the readable text tier', () => {
    // Regression: both were 3:1 (CodeMirror's #888, and --text-dim) at body sizes that need 4.5:1.
    mountEditor();
    expect(rulesFor('.cm-placeholder').join('\n')).toContain('var(--text-muted)');
    // Live preview needs a host to switch on; its theme alone is enough here.
    const live = new EditorView({ parent: document.body, extensions: [livePreviewTheme] });
    expect(rulesFor('.cm-md-fence-label').join('\n')).toContain('var(--text-muted)');
    live.destroy();
  });

  it('draws the search panel in the app’s control language, not CodeMirror’s defaults', () => {
    mountEditor();
    const button = rulesFor('.cm-button').join('\n');
    expect(button).toContain('background-image: none');
    expect(button).toContain('var(--panel-soft)');
    expect(button).toContain('1px solid var(--border)');
    expect(rulesFor('.cm-textfield').join('\n')).toContain('var(--bg)');
    // WebKit's own placeholder grey is 2.3:1 on the light page.
    expect(rulesFor('.cm-textfield::placeholder').join('\n')).toContain('var(--text-muted)');
    expect(rulesFor('.cm-panels-bottom').join('\n')).toContain('1px solid var(--border)');
    expect(rulesFor('.cm-panels').join('\n')).toContain('var(--font-sans)');
  });

  it('marks every search match visibly and counts them in the panel', async () => {
    // Regression: matches were a 20% accent tint, 1.35:1 against the page, with no count.
    mountEditor();
    const match = rulesFor('.cm-searchMatch').join('\n');
    expect(match).toMatch(/box-shadow: inset 0 -2px 0 #[0-9a-f]{6}/);
    const view = controller!.view;
    openSearchPanel(view);
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'code' })) });
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(view.dom.querySelector('.cm-search-count')?.textContent).toBe('1 match');
  });
});
