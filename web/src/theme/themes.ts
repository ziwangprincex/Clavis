// Built-in palettes. Stable IDs preserve existing saved preferences.
import { contrast, mix } from './colors';

export interface SyntaxPalette { keyword: string; name: string; literal: string; comment: string }

export interface ThemeSpec {
  label: string;
  description?: string;
  syntax?: SyntaxPalette;
  dark: boolean;
  bg: string;
  fg: string;
  gutterBg: string;
  gutterFg: string;
  activeBg: string;
  cursor: string;
  selection: string;
  /** Accent color for links/selection/focus in the surrounding app chrome. */
  accent: string;
}

export const BUILTIN_THEMES: Record<string, ThemeSpec> = {
  paper: {
    label: 'Clavis Paper', description: 'Warm ivory · botanical ink', dark: false,
    bg: '#fbf9f5', fg: '#302e2a', gutterBg: '#fbf9f5', gutterFg: '#858174',
    activeBg: '#f2efe8', cursor: '#52694f', selection: '#dfe6d8', accent: '#52694f',
    syntax: { keyword: '#755970', name: '#49645e', literal: '#826046', comment: '#6c6b60' },
  },
  ink: {
    label: 'Clavis Ink', description: 'Olive charcoal · soft sage', dark: true,
    bg: '#252724', fg: '#e1e2d9', gutterBg: '#252724', gutterFg: '#929688',
    activeBg: '#2e312b', cursor: '#aec4a4', selection: '#424f3e', accent: '#aec4a4',
    syntax: { keyword: '#c7acc2', name: '#abc3b7', literal: '#d2b798', comment: '#9fa595' },
  },
  mist: {
    label: 'Clavis Mist', description: 'Cool porcelain · muted teal', dark: false,
    bg: '#f4f7f8', fg: '#303c43', gutterBg: '#f4f7f8', gutterFg: '#7d8c92',
    activeBg: '#eaf0f2', cursor: '#496c79', selection: '#d5e4e9', accent: '#496c79',
    syntax: { keyword: '#70647f', name: '#466c7c', literal: '#826448', comment: '#5c6f6a' },
  },
  dusk: {
    label: 'Clavis Dusk', description: 'Warm charcoal · dusty violet', dark: true,
    bg: '#29262d', fg: '#ddd7de', gutterBg: '#29262d', gutterFg: '#968994',
    activeBg: '#332f38', cursor: '#c3adc9', selection: '#504358', accent: '#c3adc9',
    syntax: { keyword: '#c3adc9', name: '#afbdce', literal: '#d0b79a', comment: '#a39c98' },
  },
  'vscode-dark': {
    label: 'VS Code Dark',
    dark: true,
    bg: '#1e1e1e', fg: '#d4d4d4',
    gutterBg: '#1e1e1e', gutterFg: '#666',
    activeBg: '#252526', cursor: '#ffffff', selection: '#2b5d96',
    accent: '#4aa5ff',
  },
  'vscode-light': {
    label: 'VS Code Light',
    dark: false,
    bg: '#ffffff', fg: '#1e1e1e',
    gutterBg: '#ffffff', gutterFg: '#999',
    activeBg: '#f3f3f3', cursor: '#000000', selection: '#add6ff',
    accent: '#007aff',
  },
  'github-dark': {
    label: 'GitHub Dark',
    dark: true,
    bg: '#0d1117', fg: '#c9d1d9',
    gutterBg: '#0d1117', gutterFg: '#484f58',
    activeBg: '#161b22', cursor: '#58a6ff', selection: '#1f4e79',
    accent: '#58a6ff',
  },
  'github-light': {
    label: 'GitHub Light',
    dark: false,
    bg: '#ffffff', fg: '#1f2328',
    gutterBg: '#f6f8fa', gutterFg: '#9098a3',
    activeBg: '#f6f8fa', cursor: '#1f2328', selection: '#b6e3ff',
    accent: '#0969da',
  },
  'one-dark': {
    label: 'One Dark',
    dark: true,
    bg: '#282c34', fg: '#abb2bf',
    gutterBg: '#282c34', gutterFg: '#5c6370',
    activeBg: '#2c313a', cursor: '#528bff', selection: '#4b5263',
    accent: '#61afef',
  },
  'solarized-dark': {
    label: 'Solarized Dark',
    dark: true,
    bg: '#002b36', fg: '#93a1a1',
    gutterBg: '#073642', gutterFg: '#586e75',
    activeBg: '#073642', cursor: '#fdf6e3', selection: '#0f5468',
    accent: '#268bd2',
  },
  'solarized-light': {
    label: 'Solarized Light',
    dark: false,
    bg: '#fdf6e3', fg: '#586e75',
    gutterBg: '#eee8d5', gutterFg: '#93a1a1',
    activeBg: '#eee8d5', cursor: '#586e75', selection: '#c0ddd3',
    accent: '#268bd2',
  },
  monokai: {
    label: 'Monokai',
    dark: true,
    bg: '#272822', fg: '#f8f8f2',
    gutterBg: '#272822', gutterFg: '#75715e',
    activeBg: '#3e3d32', cursor: '#f8f8f0', selection: '#5f5e4f',
    accent: '#66d9ef',
  },
  dracula: {
    label: 'Dracula',
    dark: true,
    bg: '#282a36', fg: '#f8f8f2',
    gutterBg: '#282a36', gutterFg: '#6272a4',
    activeBg: '#44475a', cursor: '#f8f8f0', selection: '#565f89',
    accent: '#bd93f9',
  },
  nord: {
    label: 'Nord',
    dark: true,
    bg: '#2e3440', fg: '#d8dee9',
    gutterBg: '#2e3440', gutterFg: '#4c566a',
    activeBg: '#3b4252', cursor: '#d8dee9', selection: '#4c566a',
    accent: '#88c0d0',
  },
  tomorrow: {
    label: 'Tomorrow Night',
    dark: true,
    bg: '#1d1f21', fg: '#c5c8c6',
    gutterBg: '#1d1f21', gutterFg: '#5c6370',
    activeBg: '#282a2e', cursor: '#aeafad', selection: '#454a52',
    accent: '#81a2be',
  },
  material: {
    label: 'Material Darker',
    dark: true,
    bg: '#212121', fg: '#eeffff',
    gutterBg: '#212121', gutterFg: '#545454',
    activeBg: '#2c2c2c', cursor: '#ffcc00', selection: '#4d4d4d',
    accent: '#82aaff',
  },
  gruvbox: {
    label: 'Gruvbox Dark',
    dark: true,
    bg: '#282828', fg: '#ebdbb2',
    gutterBg: '#282828', gutterFg: '#7c6f64',
    activeBg: '#3c3836', cursor: '#fe8019', selection: '#665c54',
    accent: '#fabd2f',
  },
};

export const SIGNATURE_THEMES = ['paper', 'ink', 'mist', 'dusk'] as const;

/** Legible on both the page and the active line, without shouting. The active
 *  line never demands more than the theme's own body text achieves there. */
function legible(color: string, spec: ThemeSpec): string {
  const activeMinimum = Math.min(4.5, contrast(spec.fg, spec.activeBg));
  const readable = (c: string) => contrast(c, spec.bg) >= 4.5 && contrast(c, spec.activeBg) >= activeMinimum;
  for (let amount = 0; amount <= 1; amount += 0.05) {
    const out = mix(color, spec.fg, amount);
    if (readable(out)) return out;
  }
  return spec.fg;
}

/** Syntax colors for themes that ship none: the accent carries names, a cooler
 *  mix of it carries keywords, literals lean toward the text, comments recede. */
export function syntaxPalette(spec: ThemeSpec): SyntaxPalette {
  if (spec.syntax) return spec.syntax;
  return {
    name: legible(mix(spec.accent, spec.fg, 0.25), spec),
    keyword: legible(mix(spec.accent, spec.fg, 0.55), spec),
    literal: legible(mix(spec.fg, spec.accent, 0.3), spec),
    comment: legible(mix(spec.bg, spec.fg, 0.55), spec),
  };
}
