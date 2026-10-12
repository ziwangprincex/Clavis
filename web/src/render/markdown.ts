import { Marked, type Token, type Tokens } from 'marked';
import katex from 'katex';
import { frontmatterLength } from '../editor/markdownFrontmatter';
import { SCRIPT_STOP } from '../editor/markdownInlineExtras';
import { t } from '../i18n';

/** `^sup^` / `~sub~` content: no spaces or CJK text, so prose ranges stay plain. */
function script(source: string, mark: string): { raw: string; text: string } | undefined {
  if (source[0] !== mark || source[1] === mark) return;
  for (let i = 1; i < source.length; i++) {
    if (source[i] === mark) return i > 1 ? { raw: source.slice(0, i + 1), text: source.slice(1, i) } : undefined;
    if (source[i] === '\\') i++;
    else if (SCRIPT_STOP.test(source[i])) return;
  }
}

export function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Ordinary relative paths are valid; control-obfuscated and active schemes are not. */
export function sanitizeUrl(url: string, image = false): string {
  const value = url.trim();
  if (/[\u0000-\u0020\u007f]/.test(value.replace(/ /g, '')) || /^(?:\/\/|\\)/.test(value)) return '';
  if (/^data:/i.test(value)) return image && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(value) ? value : '';
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:/i.test(value) && !( !image && /^mailto:/i.test(value))) return '';
  return value;
}

function renderMath(tex: string, displayMode: boolean, output: 'html' | 'mathml' = 'html'): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, output, strict: 'ignore', trust: false });
}

/** Anchor ids as the outline and `#fragment` links use them: Unicode-safe, unique. */
function headingId(title: string, used: Set<string>): string {
  const base = title.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-') || 'section';
  let id = base, suffix = 0;
  while (used.has(id)) id = `${base}-${++suffix}`;
  used.add(id);
  return id;
}

/** What a whole-document render collects on the way: anchors and footnotes. */
interface DocumentState { used: Set<string>; notes: Map<string, string>; order: string[] }

const CALLOUT = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;
const CALLOUT_TITLES: Record<string, string> = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };

/** Extensions run inside Markdown tokenization, never on code, URLs or attributes.
 *  With `doc`, the whole-document form for export: heading anchors, footnotes,
 *  callouts, MathML formulas (no fonts needed) and diagram placeholders. */
function parser(doc?: DocumentState): Marked {
  const output = doc ? 'mathml' : 'html';
  const footnotes = doc ? [{
    name: 'footnoteDefinition', level: 'block' as const,
    start(source: string) {
      const match = /(?:^|\n)\[\^[^\]\s]+\]:/.exec(source);
      return match ? match.index + (match[0].startsWith('\n') ? 1 : 0) : undefined;
    },
    tokenizer(this: { lexer: { inlineTokens(text: string): Token[] } }, source: string) {
      const match = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*)(?:\n|$)/.exec(source);
      if (match) return { type: 'footnoteDefinition', raw: match[0], id: match[1], tokens: this.lexer.inlineTokens(match[2]) };
    },
    renderer(this: { parser: { parseInline(tokens: Token[]): string } }, token: Tokens.Generic) {
      doc.notes.set(token.id, this.parser.parseInline(token.tokens ?? []));
      return '';
    },
  }, {
    name: 'footnoteRef', level: 'inline' as const,
    start: (source: string) => source.indexOf('[^'),
    tokenizer(source: string) {
      const match = /^\[\^([^\]\s]+)\](?!:)/.exec(source);
      if (match) return { type: 'footnoteRef', raw: match[0], id: match[1] };
    },
    renderer(token: Tokens.Generic) {
      if (!doc.order.includes(token.id)) doc.order.push(token.id);
      const id = escapeAttr(token.id);
      return `<sup class="footnote-ref"><a href="#fn-${id}">${doc.order.indexOf(token.id) + 1}</a></sup>`;
    },
  }] : [];
  return new Marked({ gfm: true, breaks: false }, {
    extensions: [...footnotes, {
      name: 'displayMath', level: 'block',
      start(source) {
        const match = /(?:^|\n)\$\$/.exec(source);
        return match ? match.index + (match[0].startsWith('\n') ? 1 : 0) : undefined;
      },
      tokenizer(source) {
        const match = /^\$\$[ \t]*\n?([\s\S]+?)\$\$(?:[ \t]*(?:\n|$))/.exec(source);
        if (match) return { type: 'displayMath', raw: match[0], text: match[1] };
      },
      renderer: token => renderMath(token.text, true, output),
    }, {
      name: 'inlineMath', level: 'inline',
      start: source => source.indexOf('$'),
      tokenizer(source) {
        const display = /^\$\$([^\n]+?)\$\$/.exec(source);
        if (display) return { type: 'inlineMath', raw: display[0], text: display[1], display: true };
        const match = /^\$(?!\$)([^\s$](?:[^\n$]*?[^\s\\$])?)\$(?!\d)/.exec(source);
        if (match) return { type: 'inlineMath', raw: match[0], text: match[1] };
      },
      renderer: token => renderMath(token.text, !!token.display, output),
    }, {
      // Typora's extended syntax, as the editor's markdownInlineExtras parses it.
      name: 'highlight', level: 'inline',
      start: source => source.indexOf('=='),
      tokenizer(source) {
        const match = /^==(?!=)(?=\S)([^\n]*?\S)==(?!=)/.exec(source);
        if (match) return { type: 'highlight', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
      },
      renderer(token) { return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`; },
    }, {
      name: 'superscript', level: 'inline',
      start: source => source.indexOf('^'),
      tokenizer(source) {
        const match = script(source, '^');
        if (match) return { type: 'superscript', ...match, tokens: this.lexer.inlineTokens(match.text) };
      },
      renderer(token) { return `<sup>${this.parser.parseInline(token.tokens ?? [])}</sup>`; },
    }, {
      name: 'subscript', level: 'inline',
      start: source => source.indexOf('~'),
      tokenizer(source) {
        const match = script(source, '~');
        if (match) return { type: 'subscript', ...match, tokens: this.lexer.inlineTokens(match.text) };
        // marked's GFM also strikes through single `~…~`; the editor needs `~~`.
        if (source[0] === '~' && source[1] !== '~') return { type: 'text', raw: '~', text: '~' };
      },
      renderer(token) { return `<sub>${this.parser.parseInline(token.tokens ?? [])}</sub>`; },
    }],
    renderer: {
      ...(doc ? {
        heading({ tokens, depth }: Tokens.Heading) {
          return `<h${depth} id="${escapeAttr(headingId(plainHeading(tokens), doc.used))}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
        },
        blockquote({ tokens }: Tokens.Blockquote) {
          const inner = this.parser.parse(tokens);
          const kind = CALLOUT.exec(inner)?.[1].toLowerCase();
          if (!kind) return `<blockquote>\n${inner}</blockquote>\n`;
          const rest = inner.replace(CALLOUT, '<p>').replace(/^<p><\/p>\n?/, '');
          return `<blockquote class="callout callout-${kind}"><p class="callout-title">${t(CALLOUT_TITLES[kind])}</p>\n${rest}</blockquote>\n`;
        },
        code({ text, lang }: Tokens.Code) {
          if (lang?.trim().toLowerCase() === 'mermaid') return `<div class="diagram" data-diagram="${escapeAttr(text)}"></div>\n`;
          return false;
        },
      } : {}),
      html() { return ''; },
      link({ href, title, tokens }) {
        const safe = sanitizeUrl(href ?? '');
        const text = this.parser.parseInline(tokens);
        return safe ? `<a href="${escapeAttr(safe)}"${title ? ` title="${escapeAttr(title)}"` : ''}>${text}</a>` : text;
      },
      image({ href, title, text }) {
        const safe = sanitizeUrl(href ?? '', true);
        if (!safe) return `<span>${escapeAttr(text)}</span>`;
        const local = !/^(?:https?:|data:)/i.test(safe);
        return `<img ${local ? 'data-local-image' : 'src'}="${escapeAttr(safe)}" alt="${escapeAttr(text)}"${title ? ` title="${escapeAttr(title)}"` : ''}>`;
      },
    },
  });
}

let inline: Marked | null = null;
/** An inline fragment such as a table cell, under the same sanitizing rules. */
export function markdownInline(source: string): string {
  inline ??= parser();
  return inline.parseInline(source) as string;
}

function plainHeading(tokens: Token[]): string {
  return tokens.map(token => {
    if ('tokens' in token && Array.isArray(token.tokens)) return plainHeading(token.tokens);
    return 'text' in token ? String(token.text) : '';
  }).join('');
}

/** Top-level headings with source lines and Unicode/duplicate-safe anchor ids. */
export function markdownHeadings(source: string): { line: number; title: string; level: number; id: string }[] {
  const md = parser();
  // Front matter is metadata, not a rule plus a setext heading; keep its lines for numbering.
  const meta = frontmatterLength(source);
  const tokens = md.lexer(source.slice(0, meta).replace(/[^\n]/g, '') + source.slice(meta));
  const used = new Set<string>();
  let line = 1;
  const headings: { line: number; title: string; level: number; id: string }[] = [];
  for (const token of tokens) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading;
      const title = plainHeading(heading.tokens);
      headings.push({ line, title, level: heading.depth - 1, id: headingId(title, used) });
    }
    line += (token.raw.match(/\n/g) ?? []).length;
  }
  return headings;
}

/** A whole document as HTML for export, with its title (front matter `title:`,
 *  else the first heading). Local images keep `data-local-image` and diagrams
 *  stay `data-diagram` placeholders for the exporter to fill in. */
export function markdownDocument(source: string): { title: string; html: string } {
  const meta = frontmatterLength(source);
  const title = /^title:\s*["']?(.*?)["']?\s*$/m.exec(source.slice(0, meta))?.[1] ?? '';
  const doc: DocumentState = { used: new Set(), notes: new Map(), order: [] };
  let html = parser(doc).parse(source.slice(meta)) as string;
  const ids = [...doc.order.filter(id => doc.notes.has(id)), ...[...doc.notes.keys()].filter(id => !doc.order.includes(id))];
  if (ids.length) {
    html += `<section class="footnotes"><ol>${ids.map(id => `<li id="fn-${escapeAttr(id)}">${doc.notes.get(id)}</li>`).join('')}</ol></section>\n`;
  }
  return { title: title || markdownHeadings(source)[0]?.title || '', html };
}
