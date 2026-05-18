// Markdown + KaTeX rendering, ported from ui-legacy/app.js (lines 537-552).

import { marked } from 'marked';
import katex from 'katex';

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
