import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, useSettingsStore } from '../store/settings';
import { ipc } from '../api/tauri';

vi.mock('../api/tauri', () => ({ ipc: { getSettings: vi.fn() } }));
const sources = import.meta.glob<string>([
  '../components/*.module.css', '../App.module.css', '../editor/controller.ts',
  '../editor/livePreview.ts', '../components/EditorPane.tsx',
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
    expect(read('../components/EditorPane.module.css')).toContain('var(--editor-inline-padding, 12px)');
    // Only formatted Markdown gets a centered page; source stays compact.
    const centered: string[] = [];
    editor.walkRules(rule => {
      if (Object.values(declarations(rule)).some(value => value.includes('100% -'))) centered.push(rule.selector);
    });
    expect(centered).toEqual(['.host[data-live] :global(.cm-scroller)']);
    expect(read('../App.module.css')).toContain('100% - 68ch');
    expect(read('../App.module.css')).toContain('100% - 78ch');
  });

  it('centers source only in opt-in Focus, keeping ordinary Write and Split compact', () => {
    const overrides: Rule[] = [];
    postcss.parse(read('../App.module.css')).walkRules(rule => {
      if (declarations(rule)['--editor-inline-padding']) overrides.push(rule);
    });
    expect(overrides).toHaveLength(2);
    for (const rule of overrides) expect(rule.selector).toMatch(/^\.focusMode /);
    expect(read('../components/EditorPane.module.css')).toContain('var(--editor-top-padding, 24px)');
  });

  it('uses a compact, aligned titlebar without shrinking the action hit targets', () => {
    const rules = (name: string) => {
      const out = new Map<string, Record<string, string>>();
      sheet(name).walkRules(rule => {
        if (rule.parent?.type === 'root') out.set(rule.selector, declarations(rule));
      });
      return out;
    };
    expect(rules('Toolbar').get('.toolbar')?.height).toBe('48px');
    expect(rules('TitleBar').get('.titlebar')?.height).toBe('48px');
    expect(rules('TitleBar').get('.titlebar.mac')?.['padding-left']).toBe('76px');
    expect(rules('Toolbar').get('.iconBtn, .textBtn, .primaryBtn')?.['min-height']).toBe('32px');
    expect(rules('Toolbar').get('.primaryBtn')?.background).toBe('var(--panel-soft)');
    const sidebar = rules('Sidebar');
    expect(sidebar.has('.heading')).toBe(false);
    expect(sidebar.get('.views')?.['border-bottom']).toBeUndefined();
    expect(sidebar.get('.view')?.['border-bottom']).toBeUndefined();
    expect(sidebar.get('.view.selected')?.['border-bottom-color']).toBeUndefined();
    expect(sidebar.get('.view')?.width).toBe('32px');
    expect(sidebar.get('.view')?.height).toBe('32px');
    // The selected view is filled, as Texifier marks its sidebar tab.
    expect(sidebar.get('.view.selected')?.background).toBe('var(--accent)');
    expect(sidebar.get('.view.selected')?.color).toBe('var(--on-accent)');
    expect(rules('Tabs').get('.tab')?.['min-height']).toBe('36px');
  });

  it('keeps Markdown page widths ordered and proportional to the body font size', () => {
    const measures = /narrow: '(\d+)em', medium: '(\d+)em', wide: '(\d+)em'/.exec(read('../components/EditorPane.tsx'));
    expect(measures).not.toBeNull();
    const [narrow, medium, wide] = measures!.slice(1).map(Number);
    expect(narrow).toBeLessThan(medium);
    expect(medium).toBeLessThan(wide);
    expect(read('../components/EditorPane.module.css')).toContain('calc((100% - var(--writing-measure, 36em)) / 2)');
  });

  it('keeps displayed math and tables horizontally scrollable in formatted Markdown', () => {
    const source = read('../editor/livePreview.ts');
    expect(source).toMatch(/'\.cm-md-math-block': \{[^}]*overflowX: 'auto'/);
    expect(source).toMatch(/'\.cm-md-table': \{[^}]*overflowX: 'auto'/);
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
