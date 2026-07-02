// Markdown + KaTeX rendering, ported from ui-legacy/app.js (lines 537-552).

import { marked } from 'marked';
import katex from 'katex';

// Restrict marked output: no raw HTML from the source, links go through a
// sanitizer that rejects javascript:/data: schemes.
marked.use({
  renderer: {
    html() {
      // Drop raw <html> passthrough entirely — user markdown cannot inject tags.
      return '';
    },
    link({ href, title, tokens }) {
      const safe = sanitizeUrl(href ?? '');
      const t = title ? ` title="${escapeAttr(title)}"` : '';
      const text = this.parser.parseInline(tokens);
      return `<a href="${escapeAttr(safe)}"${t}>${text}</a>`;
    },
    image({ href, title, text }) {
      const safe = sanitizeUrl(href ?? '');
      const t = title ? ` title="${escapeAttr(title)}"` : '';
      const a = text ? ` alt="${escapeAttr(text)}"` : '';
      return `<img src="${escapeAttr(safe)}"${a}${t}>`;
    },
  },
});

function sanitizeUrl(url: string): string {
  const u = url.trim();
  // Allow http(s), mailto, relative, fragment, and data: images (KaTeX SVG).
  if (/^(?:https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(u)) return u;
  if (/^data:image\//i.test(u)) return u;
  return '';
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: 'html',
      strict: 'ignore',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `<span class="err">${escapeHtml(msg)}</span>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function markdownWithMath(src: string): string {
  const ph: string[] = [];
  const stash = (h: string) => {
    const k = `\u0000M${ph.length}\u0000`;
    ph.push(h);
    return k;
  };
  let s = src;
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, b: string) => stash(renderKatex(b, true)));
  s = s.replace(/(?<!\\)\$([^\n$]+?)(?<!\\)\$/g, (_, b: string) => stash(renderKatex(b, false)));
  let html = marked.parse(s, { async: false }) as string;
  html = html.replace(/\u0000M(\d+)\u0000/g, (_, i) => ph[+i] ?? '');
  return html;
}
