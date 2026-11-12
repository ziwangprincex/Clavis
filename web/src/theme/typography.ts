import type { CSSProperties } from 'react';
import { defaultSettings, type Settings } from '../store/settings';

/** Serif headings need less size than sans ones to stand out: 1.75 / 1.3 / 1.12. */
export const headingSizes: Record<string, number> = { h1: 1.75, h2: 1.3, h3: 1.12, h4: 1.04, h5: 1, h6: 1 };
export function previewTypography(settings: Settings): CSSProperties {
  // Kai for quotations and emphasis belongs to the typeset face; with a font
  // of the user's own, they stay in that font.
  const typeset = !settings.preview_font_family || settings.preview_font_family === defaultSettings.preview_font_family;
  const style: Record<string, string | number> = {
    fontFamily: settings.preview_font_family || defaultSettings.preview_font_family,
    fontSize: `${settings.preview_font_size}px`,
    lineHeight: settings.preview_line_height,
    '--quote-font': settings.preview_quote_font_family || (typeset ? 'var(--font-quote)' : 'inherit'),
    '--emphasis-font': settings.preview_quote_font_family || (typeset ? 'var(--font-quote)' : 'inherit'),
    '--quote-style': typeset ? 'italic' : 'normal',
    '--inline-code-font': settings.preview_inline_code_font_family || settings.editor_font_family || defaultSettings.editor_font_family,
    '--code-font': settings.preview_code_font_family || settings.editor_font_family || defaultSettings.editor_font_family,
  };
  for (const [level, size] of Object.entries(headingSizes)) {
    style[`--${level}-font`] = settings.preview_heading_fonts[level] || 'inherit';
    style[`--${level}-size`] = `${settings.preview_heading_sizes[level] || size}em`;
    style[`--${level}-weight`] = settings.preview_heading_weights[level] || 600;
  }
  return style as CSSProperties;
}

export function fontStack(family: string): string {
  return `"${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
const GENERIC = /^(?:serif|sans-serif|monospace|system-ui|ui-.+|cursive|fantasy|math|emoji|fangsong|-apple-system|BlinkMacSystemFont)$/i;
const families = (stack: string) => (stack.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+/g) ?? [])
  .map(name => name.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
export function missingFonts(stack: string, installed: string[]): string[] {
  const available = new Set(installed.map(name => name.toLowerCase()));
  return families(stack).filter(name => !GENERIC.test(name) && !available.has(name.toLowerCase()));
}
/** The font a stack asks for first, or null when that is the system's own. */
export function primaryFamily(stack: string): string | null {
  const first = families(stack)[0];
  return first && !GENERIC.test(first) ? first : null;
}
