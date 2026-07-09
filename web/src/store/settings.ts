// Settings store — mirrors the Rust `Settings` struct in src/settings.rs.
// Fields use snake_case to match Rust serde defaults (no rename_all there).

import { create } from 'zustand';
import { ipc } from '../api/tauri';

export interface Settings {
  latex_engine: string;
  bib_engine: 'auto' | 'bibtex' | 'biber' | 'none' | string;
  auto_rerun: boolean;
  max_runs: number;
  latex_custom_paths: Record<string, string>;
  pdf_dark_mode: 'off' | 'on' | 'invert' | 'sepia' | string;
  /** Custom PDF background color (hex). Empty = use theme default. */
  pdf_bg_color: string;
  editor_font_family: string;
  editor_font_size: number;
  editor_line_height: number;
  editor_theme: string;
  editor_theme_overrides: Record<string, string>;
  editor_spellcheck: boolean;
  /** Tab width in spaces. */
  editor_tab_size: number;
  /** Whether Tab inserts spaces (true) or a literal tab (false). */
  editor_indent_with_spaces: boolean;
  recent_files: string[];
  pane_sidebar_width: number;
  pane_editor_width: number;
  /** Periodically write dirty, file-backed tabs to disk. Opt-in. */
  autosave_enabled: boolean;

  // ----- UI-level customisation (consumed by App, not by Rust) -----
  /** App chrome theme: dark | light | auto (follow OS). */
  ui_theme: 'dark' | 'light' | 'auto';
  /** Font family for non-editor UI text (toolbar, sidebar, dialogs, etc.). */
  ui_font_family: string;
  /** Base font size (px) for non-editor UI text. */
  ui_font_size: number;
  /** Accent / link color override (hex). Empty = use theme default. */
  ui_accent_color: string;
  /** Font family for the Markdown / Typst preview surface. */
  preview_font_family: string;
  /** Base font size (px) for the preview surface. */
  preview_font_size: number;
  /** Custom CSS variable overrides applied to :root. Hex or named colors. */
  ui_color_overrides: Record<string, string>;
}

export const defaultSettings: Settings = {
  latex_engine: 'pdflatex',
  bib_engine: 'auto',
  auto_rerun: true,
  max_runs: 4,
  latex_custom_paths: {},
  pdf_dark_mode: 'off',
  pdf_bg_color: '',
  editor_font_family:
    '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, Menlo, monospace',
  editor_font_size: 14,
  editor_line_height: 1.55,
  editor_theme: 'vscode-dark',
  editor_theme_overrides: {},
  editor_spellcheck: false,
  editor_tab_size: 2,
  editor_indent_with_spaces: true,
  recent_files: [],
  pane_sidebar_width: 0,
  pane_editor_width: 0,
  autosave_enabled: false,

  ui_theme: 'auto',
  ui_font_family:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  ui_font_size: 13,
  ui_accent_color: '',
  preview_font_family:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  preview_font_size: 14,
  ui_color_overrides: {},
};

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  patch: (delta: Partial<Settings>) => void;
  save: () => Promise<void>;
  patchAndSave: (delta: Partial<Settings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: defaultSettings,
  loaded: false,
  async load() {
    try {
      const raw = (await ipc.getSettings()) as Partial<Settings> | null;
      set({ settings: { ...defaultSettings, ...(raw ?? {}) }, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  patch(delta) {
    set({ settings: { ...get().settings, ...delta } });
  },
  async save() {
    try {
      await ipc.setSettings(get().settings as unknown as Record<string, unknown>);
    } catch (e) {
      // Surface to console for now; UI feedback added when Settings panel migrates.
      console.error('setSettings failed', e);
    }
  },
  async patchAndSave(delta) {
    set({ settings: { ...get().settings, ...delta } });
    await get().save();
  },
}));
