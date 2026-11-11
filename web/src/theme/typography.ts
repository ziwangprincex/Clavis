import type { CSSProperties } from 'react';
import { defaultSettings, type Settings } from '../store/settings';

export const headingSizes: Record<string, number> = { h1: 2, h2: 1.5, h3: 1.22, h4: 1.06, h5: 1, h6: 1 };
export function previewTypography(settings: Settings): CSSProperties {
  const style: Record<string, string | number> = {
    fontFamily: settings.preview_font_family || 'var(--font-sans)',
    fontSize: `${settings.preview_font_size}px`,
    lineHeight: settings.preview_line_height,
    '--quote-font': settings.preview_quote_font_family || 'inherit',
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
