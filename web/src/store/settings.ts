// Settings store — mirrors the Rust `Settings` struct in src/settings.rs.
// Fields use snake_case to match Rust serde defaults (no rename_all there).

import { create } from 'zustand';
import { ipc } from '../api/tauri';

export type EditorLayout = 'editor' | 'split' | 'preview';

export interface Settings {
  ui_language: 'auto' | 'en' | 'zh-CN';
  ui_mono_font_family: string;
  preview_line_height: number;
  preview_heading_fonts: Record<string, string>;
  preview_heading_sizes: Record<string, number>;
  preview_heading_weights: Record<string, number>;
  preview_quote_font_family: string;
  preview_inline_code_font_family: string;
  preview_code_font_family: string;
  editor_layout: EditorLayout;
  sidebar_visible: boolean;
  latex_engine: string;
  bib_engine: 'auto' | 'bibtex' | 'biber' | 'none' | string;
  auto_rerun: boolean;
  max_runs: number;
  latex_custom_paths: Record<string, string>;
  pdf_dark_mode: 'off' | 'on' | 'invert' | 'sepia' | string;
  editor_font_family: string;
  editor_font_size: number;
  editor_line_height: number;
  editor_theme: string;
  editor_theme_overrides: Record<string, string>;
  editor_spellcheck: boolean;
  editor_inline_math: boolean;
  /** Tab width in spaces. */
  editor_tab_size: number;
  /** Whether Tab inserts spaces (true) or a literal tab (false). */
  editor_indent_with_spaces: boolean;
  recent_files: string[];
  /** Recently opened workspace folders (most-recent first). */
  recent_folders: string[];
  /** Recently inserted bibliography keys, newest first. */
  recent_citations: string[];
  pane_sidebar_width: number;
  /** Editor's share of the editor/preview row, 0..1. 0 = use the 50/50 default.
   *  Stored as a ratio (not px) so window resizes keep rebalancing the split. */
  pane_editor_ratio: number;
  pane_log_height: number;
  /** Periodically write dirty, file-backed tabs to disk. Opt-in. */
  autosave_enabled: boolean;

  // ----- UI-level customisation (consumed by App, not by Rust) -----
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
  /** Whether the LaTeX problems panel is open. */
  problems_panel_open: boolean;
  /** Preview surface: keep it as a light paper page, or derive from the theme. */
  preview_paper: 'light' | 'match';
  /**
   * Reading line length for the preview surface. `narrow` (~65 characters) is
   * the typographic optimum for prose; `medium` (~80) suits documents with wide
   * tables or long display math; `wide` keeps the historical 880px column.
   */
  preview_reading_width: 'narrow' | 'medium' | 'wide';
  /** Offer commands from the bundled TeXstudio `.cwl` corpus. */
  cwl_enabled: boolean;
  /**
   * Rank commands the corpus marks `#*` (unusual) alongside ordinary ones.
   * They are always offered — `#*` covers a quarter of the corpus and includes
   * useful commands — but sort last by default.
   */
  cwl_show_unusual: boolean;
  /**
   * Filter completions by math/text/environment context, per the corpus's
   * `#m` / `#n` / `#t` / `/env` classifiers. Turn off to diagnose a command
   * that should be offered but is not.
   */
  cwl_respect_context: boolean;
  /** Optional estimated main-text word target; 0 disables the warning. */
  writing_main_word_limit: number;
  /** Optional estimated Abstract word target; 0 disables the warning. */
  writing_abstract_word_limit: number;
}

export const defaultSettings: Settings = {
  ui_language: 'auto',
  ui_mono_font_family: '',
  preview_line_height: 1.75,
  preview_heading_fonts: {},
  preview_heading_sizes: {},
  preview_heading_weights: {},
  preview_quote_font_family: '',
  preview_inline_code_font_family: '',
  preview_code_font_family: '',
  editor_layout: 'editor',
  sidebar_visible: false,
  latex_engine: 'pdflatex',
  bib_engine: 'auto',
  auto_rerun: true,
  max_runs: 4,
  latex_custom_paths: {},
  pdf_dark_mode: 'off',
  editor_font_family:
    '"Maple Mono NF", "Maple Mono NF CN", "JetBrains Mono", "IBM Plex Mono", "Cascadia Code", Consolas, Menlo, monospace',
  editor_font_size: 16,
  editor_line_height: 1.85,
  editor_theme: 'auto',
  editor_theme_overrides: {},
  editor_spellcheck: false,
  editor_inline_math: false,
  editor_tab_size: 2,
  editor_indent_with_spaces: true,
  recent_files: [],
  recent_folders: [],
  recent_citations: [],
  pane_sidebar_width: 0,
  pane_editor_ratio: 0,
  pane_log_height: 0,
  autosave_enabled: false,

  ui_font_family:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  ui_font_size: 13,
  ui_accent_color: '',
  preview_font_family:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  preview_font_size: 17,
  ui_color_overrides: {},
  problems_panel_open: false,
  preview_paper: 'match',
  preview_reading_width: 'narrow',
  cwl_enabled: true,
  cwl_show_unusual: false,
  cwl_respect_context: true,
  writing_main_word_limit: 0,
  writing_abstract_word_limit: 0,
};

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  saveError: string | null;
  saveDraft: (delta: Partial<Settings>) => Promise<void>;
  load: () => Promise<void>;
  patch: (delta: Partial<Settings>) => void;
  save: () => Promise<void>;
  patchAndSave: (delta: Partial<Settings>) => Promise<void>;
}

/**
 * Forward-migrate a loaded settings object.
 *
 * `pane_editor_width` (absolute px) was replaced by `pane_editor_ratio` (0..1)
 * because pinning the editor to a pixel width froze the editor/preview split on
 * window resize. The old key is a typed field on the Rust struct, so it keeps
 * round-tripping; convert it once against a nominal 1200px row so existing
 * installs land near their previous split instead of snapping back to 50/50.
 */
export function migrateSettings(s: Settings): Settings {
  // Retire the old canvas-color preference: paper surroundings are not a color control.
  let migrated = { ...s };
  delete (migrated as Settings & { pdf_bg_color?: unknown }).pdf_bg_color;
  const legacyPx = (s as unknown as { pane_editor_width?: number }).pane_editor_width;
  if (!s.pane_editor_ratio && typeof legacyPx === 'number' && legacyPx > 120) {
    const ratio = legacyPx / 1200;
    migrated = { ...migrated, pane_editor_ratio: Math.max(0.15, Math.min(0.85, ratio)) };
  }

  if (!['narrow', 'medium', 'wide'].includes(migrated.preview_reading_width)) {
    migrated = { ...migrated, preview_reading_width: defaultSettings.preview_reading_width };
  }

  if (!['editor', 'split', 'preview'].includes(migrated.editor_layout)) {
    migrated = { ...migrated, editor_layout: 'split' };
  }
  if (typeof migrated.sidebar_visible !== 'boolean') {
    migrated = { ...migrated, sidebar_visible: true };
  }
  if (!['auto', 'en', 'zh-CN'].includes(migrated.ui_language)) migrated = { ...migrated, ui_language: 'auto' };
  return migrated;
}

let writeQueue = Promise.resolve();
function queueSettingsWrite(action: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(action, action);
  writeQueue = next.catch(() => {});
  return next;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: defaultSettings,
  loaded: false,
  saveError: null,
  async saveDraft(delta) {
    await queueSettingsWrite(async () => {
      const settings = { ...get().settings, ...delta };
      await ipc.setSettings(settings as unknown as Record<string, unknown>);
      set({ settings: { ...get().settings, ...delta }, saveError: null });
    });
  },
  async load() {
    try {
      const raw = (await ipc.getSettings()) as Partial<Settings> | null;
      set({ settings: migrateSettings({ ...defaultSettings, ...(raw ?? {}) }), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  patch(delta) {
    set({ settings: { ...get().settings, ...delta } });
  },
  async save() {
    try {
      await queueSettingsWrite(() => ipc.setSettings(get().settings as unknown as Record<string, unknown>));
      set({ saveError: null });
    } catch (e) {
      set({ saveError: String(e) });
    }
  },
  async patchAndSave(delta) {
    set({ settings: { ...get().settings, ...delta } });
    await get().save();
  },
}));
