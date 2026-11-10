import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, useSettingsStore } from '../store/settings';
import { ipc } from '../api/tauri';

vi.mock('../api/tauri', () => ({ ipc: { getSettings: vi.fn() } }));
const sources = import.meta.glob<string>([
  '../components/*.module.css', '../App.module.css', '../editor/controller.ts',
  '../editor/livePreviewTheme.ts', '../components/EditorPane.tsx',
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
    expect(read('../components/EditorPane.module.css')).toContain('var(--editor-inline-padding,');
    // Only formatted Markdown gets a centered page; source stays compact.
    const centered: string[] = [];
    editor.walkRules(rule => {
      if (Object.values(declarations(rule)).some(value => value.includes('100% -'))) centered.push(rule.selector);
    });
    expect(centered).toEqual(['.host[data-live] :global(.cm-scroller)']);
  });

  it('centers source only in opt-in Focus, keeping ordinary Write and Split compact', () => {
    const overrides: Rule[] = [];
    postcss.parse(read('../App.module.css')).walkRules(rule => {
      if (declarations(rule)['--editor-inline-padding']) overrides.push(rule);
    });
    expect(overrides).toHaveLength(2);
    for (const rule of overrides) expect(rule.selector).toMatch(/^\.focusMode /);
    // Focus sets Markdown on a narrower measure than source.
    const measure = (rule: Rule) => Number(/100% - (\d+)ch/.exec(declarations(rule)['--editor-inline-padding'])?.[1]);
    const markdown = overrides.find(rule => rule.selector.includes("[data-language='markdown']"));
    const source = overrides.find(rule => rule !== markdown);
    expect(measure(markdown!)).toBeLessThan(measure(source!));
    expect(read('../components/EditorPane.module.css')).toContain('var(--editor-top-padding,');
  });

  // The rules from tokens.css ("Density" and "Shape"), not the values: the
  // chrome may get denser or rounder by changing a token, but no bar, control
  // or corner may drift off the shared scale.
  const CHROME = ['Toolbar', 'TitleBar', 'Sidebar', 'FolderTreeSection', 'OutlineSection',
    'FilesSection', 'WritingSection', 'StartActions', 'Tabs', 'StatusBar'];
  const decls = (prop: RegExp) => CHROME.flatMap(name => {
    const out: { where: string; value: string }[] = [];
    sheet(name).walkDecls(prop, decl => {
      out.push({ where: `${name} ${(decl.parent as Rule).selector} { ${decl.prop} }`, value: decl.value });
    });
    return out;
  });

  it('sizes every bar, control and row from the density tokens', () => {
    // Fixed sizes that are not chrome rows: Windows caption buttons follow the
    // platform's 32px, and the writing-check panel is a container.
    const exempt = new Set(['TitleBar .controls { height }', 'WritingSection .root { min-height }']);
    const offScale = decls(/^(height|min-height)$/)
      .filter(({ where, value }) => /^\d+px$/.test(value) && parseInt(value) >= 24 && !exempt.has(where))
      .map(({ where, value }) => `${where}: ${value}`);
    expect(offScale).toEqual([]);
  });

  it('rounds chrome corners only with the shape tokens', () => {
    const token = /^(var\(--radius-(sm|md|lg)\)|calc\(var\(--radius-(sm|md|lg)\) [+-] \d+px\)|50%|999px)$/;
    const offScale = decls(/^border-radius$/)
      .filter(({ value }) => !token.test(value))
      .map(({ where, value }) => `${where}: ${value}`);
    expect(offScale).toEqual([]);
  });

  it('lines the toolbar up with the titlebar and clears the macOS window buttons', () => {
    const rule = (name: string, selector: string) => {
      let found: Record<string, string> | undefined;
      sheet(name).walkRules(item => {
        if (item.parent?.type === 'root' && item.selector === selector) found = { ...found, ...declarations(item) };
      });
      return found;
    };
    expect(rule('Toolbar', '.toolbar')?.height).toBe(rule('TitleBar', '.titlebar')?.height);
    // Overlay title bar: the traffic lights sit over the first ~70px.
    expect(parseInt(rule('TitleBar', '.titlebar.mac')?.['padding-left'] ?? '0')).toBeGreaterThanOrEqual(70);
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
    const source = read('../editor/livePreviewTheme.ts');
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
