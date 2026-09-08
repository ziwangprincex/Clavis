// Built-in palettes. Stable IDs preserve existing saved preferences.
export interface ThemeSpec {
  label: string;
  description?: string;
  syntax?: { keyword: string; name: string; literal: string; comment: string };
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
    label: 'Clavis Paper', description: 'Warm paper · slate blue', dark: false,
    bg: '#faf9f6', fg: '#30343b', gutterBg: '#faf9f6', gutterFg: '#858890',
    activeBg: '#f1f1ee', cursor: '#536b86', selection: '#dce4ed', accent: '#536b86',
    syntax: { keyword: '#75617c', name: '#49677f', literal: '#876444', comment: '#646a63' },
  },
  ink: {
    label: 'Clavis Ink', description: 'Soft graphite · cool silver', dark: true,
    bg: '#20242b', fg: '#d5d9e0', gutterBg: '#20242b', gutterFg: '#7e8794',
    activeBg: '#292e36', cursor: '#a7bcd4', selection: '#39495e', accent: '#a7bcd4',
    syntax: { keyword: '#c2b1ce', name: '#a7bcd4', literal: '#cbb592', comment: '#929f99' },
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
