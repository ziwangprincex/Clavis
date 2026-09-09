import { Marked, type Token, type Tokens } from 'marked';
import katex from 'katex';

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

function renderMath(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'html', strict: 'ignore', trust: false });
}

/** Extensions run inside Markdown tokenization, never on code, URLs or attributes. */
function parser(): Marked {
  return new Marked({ gfm: true, breaks: false }, {
    extensions: [{
      name: 'displayMath', level: 'block',
      start(source) {
        const match = /(?:^|\n)\$\$/.exec(source);
        return match ? match.index + (match[0].startsWith('\n') ? 1 : 0) : undefined;
      },
      tokenizer(source) {
        const match = /^\$\$[ \t]*\n?([\s\S]+?)\$\$(?:[ \t]*(?:\n|$))/.exec(source);
        if (match) return { type: 'displayMath', raw: match[0], text: match[1] };
      },
      renderer: token => renderMath(token.text, true),
    }, {
      name: 'inlineMath', level: 'inline',
      start: source => source.indexOf('$'),
      tokenizer(source) {
        const display = /^\$\$([^\n]+?)\$\$/.exec(source);
        if (display) return { type: 'inlineMath', raw: display[0], text: display[1], display: true };
        const match = /^\$(?!\$)([^\s$](?:[^\n$]*?[^\s\\$])?)\$(?!\d)/.exec(source);
        if (match) return { type: 'inlineMath', raw: match[0], text: match[1] };
      },
      renderer: token => renderMath(token.text, !!token.display),
    }],
    renderer: {
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

function plainHeading(tokens: Token[]): string {
  return tokens.map(token => {
    if ('tokens' in token && Array.isArray(token.tokens)) return plainHeading(token.tokens);
    return 'text' in token ? String(token.text) : '';
  }).join('');
}

/** The same top-level tokens power source outline and rendered anchors. */
export function markdownHeadings(source: string): { line: number; title: string; level: number; id: string }[] {
  const md = parser();
  const tokens = md.lexer(source);
  const used = new Set<string>();
  let line = 1;
  const headings: { line: number; title: string; level: number; id: string }[] = [];
  for (const token of tokens) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading;
      const title = plainHeading(heading.tokens);
      const base = title.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-') || 'section';
      let id = base, suffix = 0;
      while (used.has(id)) id = `${base}-${++suffix}`;
      used.add(id);
      headings.push({ line, title, level: heading.depth - 1, id });
    }
    line += (token.raw.match(/\n/g) ?? []).length;
  }
  return headings;
}

export function markdownWithMath(source: string): string {
  const headings = markdownHeadings(source);
  const md = parser();
  const tokens = md.lexer(source);
  const anchors = new Map<Token, typeof headings[number]>();
  let index = 0;
  for (const token of tokens) if (token.type === 'heading') anchors.set(token, headings[index++]);
  md.use({ renderer: { heading(token) {
    const { depth, tokens } = token;
    const heading = anchors.get(token);
    const attrs = heading ? ` id="${escapeAttr(heading.id)}" data-source-line="${heading.line}"` : '';
    return `<h${depth}${attrs}>${this.parser.parseInline(tokens)}</h${depth}>\n`;
  } } });
  return md.parser(tokens);
}
