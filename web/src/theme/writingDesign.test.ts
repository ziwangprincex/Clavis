import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, useSettingsStore } from '../store/settings';
import { ipc } from '../api/tauri';

vi.mock('../api/tauri', () => ({ ipc: { getSettings: vi.fn() } }));
const sources = import.meta.glob<string>([
  '../components/*.module.css', '../App.module.css', '../editor/controller.ts',
], { query: '?raw', import: 'default', eager: true });
const read = (path: string) => sources[path];
const sheet = (name: string) => postcss.parse(read(`../components/${name}.module.css`));
const declarations = (rule: Rule) => Object.fromEntries(
  rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]),
);

// Static stylesheet contracts, not a claim of measured native layout/appearance.
describe('editorial writing surfaces', () => {
  it.each(['EditorPane', 'PreviewPane', 'Sidebar', 'Tabs', 'Toolbar', 'FilesSection'])(
    '%s: keeps tag styles local to its component', name => {
      let count = 0;
      sheet(name).walkRules(rule => {
        if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
        for (const selector of rule.selectors) {
          expect(selector).toMatch(/^\.[\w-]+/);
          count++;
        }
      });
      expect(count).toBeGreaterThan(5);
    },
  );

  it('adapts to pane width instead of window width, without resizing CM content', () => {
    const editor = sheet('EditorPane');
    const containers: string[] = [];
    editor.walkAtRules('container', rule => { containers.push(rule.params); });
    expect(containers).toContain('writing-pane (max-width: 560px)');
    editor.walkRules(rule => {
      const values = declarations(rule);
      if (rule.selector.endsWith(':global(.cm-content)')) {
        expect(values['max-width']).toBeUndefined();
        expect(values.transform).toBeUndefined();
      }
    });
    expect(read('../components/EditorPane.module.css')).toContain('100% - 68ch');
    expect(read('../components/EditorPane.module.css')).toContain('100% - 78ch');
    expect(read('../App.module.css')).not.toContain('--editor-inline-padding');
  });

  it('keeps ordinary Write insets fixed without changing Split, Read or Focus', () => {
    const overrides: Rule[] = [];
    postcss.parse(read('../App.module.css')).walkRules(rule => {
      if (rule.selector.includes(':global(.cm-scroller)')) overrides.push(rule);
    });
    expect(overrides).toHaveLength(1);
    expect(overrides[0].selector).toBe(".app[data-layout='editor']:not(.focusMode) .editorPane :global(.cm-scroller)");
    expect(overrides[0].parent?.type).toBe('root');
    expect(declarations(overrides[0])).toEqual({ 'padding-inline': '12px' });
  });

  it('keeps reading widths ordered and proportional to the selected font size', () => {
    const rules = new Map<string, Record<string, string>>();
    sheet('PreviewPane').walkRules(rule => {
      if (rule.parent?.type === 'root') rules.set(rule.selector, declarations(rule));
    });
    expect(rules.get('.widthNarrow')?.['--reading-measure']).toBe('34em');
    expect(rules.get('.widthMedium')?.['--reading-measure']).toBe('42em');
    expect(rules.get('.preview')?.['--reading-measure']).toBe('50em');
    expect(rules.get('.preview')?.['max-width']).toBe('calc(var(--reading-measure) + 2 * var(--reading-inset))');
    expect(rules.get('.preview')?.flex).toBe('none');
    expect(read('../components/PreviewPane.module.css')).toContain('@container reading-pane');
  });

  it('keeps code and displayed math horizontally scrollable', () => {
    const rules = new Map<string, Record<string, string>>();
    sheet('PreviewPane').walkRules(rule => { rules.set(rule.selector, declarations(rule)); });
    expect(rules.get('.markdown :global(pre)')?.['overflow-x']).toBe('auto');
    expect(rules.get('.markdown :global(.katex-display)')?.['overflow-x']).toBe('auto');
    expect(rules.get('.markdown :global(pre code)')?.['font-size']).toBe('inherit');
    sheet('PreviewPane').walkRules(rule => {
      if (rule.selector.includes(':global(td)') || rule.selector.includes(':global(th)')) {
        expect(declarations(rule)['text-align']).toBeUndefined();
      }
    });
  });

  it('never turns every completion row into a selected row', () => {
    const source = read('../editor/controller.ts');
    expect(source).toContain('li[aria-selected=true]');
    expect(source).not.toContain('li[aria-selected]');
    expect(source).not.toContain('textTransform');
  });

  it('provides larger first-run defaults without replacing saved typography', async () => {
    const previous = useSettingsStore.getState();
    try {
      expect(defaultSettings.editor_font_size).toBe(16);
      expect(defaultSettings.preview_font_size).toBe(17);
      const saved = {
        editor_font_family: 'Custom Mono', editor_font_size: 15, editor_line_height: 2,
        preview_font_family: 'Custom Serif', preview_font_size: 24,
        ui_font_family: 'Custom UI', ui_font_size: 18,
        editor_theme: 'dusk', ui_accent_color: '#654321',
      };
      vi.mocked(ipc.getSettings).mockResolvedValue(saved);
      await useSettingsStore.getState().load();
      expect(useSettingsStore.getState().settings).toMatchObject(saved);
    } finally {
      useSettingsStore.setState(previous);
      vi.clearAllMocks();
    }
  });
});
