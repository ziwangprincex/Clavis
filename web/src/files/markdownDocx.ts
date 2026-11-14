// Rendered Markdown (the same DOM the HTML export writes) as WordprocessingML.
// Headings, paragraphs, inline styles, links, lists, quotes, code, tables and
// embedded PNG/JPEG/GIF images are kept; anything else falls back to its text.

import { buildDocx, imageSize, pictureXml, xmlEscape, type Picture } from './docxPackage';

interface Format { b?: boolean; i?: boolean; s?: boolean; code?: boolean; link?: boolean; sup?: boolean; sub?: boolean; mark?: boolean }

interface Context {
  pictures: Picture[];
  links: string[];
  orderedLists: number;
  nextDrawing: number;
}

function runProps(format: Format): string {
  let props = '';
  if (format.link) props += '<w:rStyle w:val="Hyperlink"/>';
  if (format.code) props += '<w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:cs="Menlo"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>';
  if (format.b) props += '<w:b/>';
  if (format.i) props += '<w:i/>';
  if (format.s) props += '<w:strike/>';
  if (format.mark) props += '<w:highlight w:val="yellow"/>';
  if (format.sup) props += '<w:vertAlign w:val="superscript"/>';
  if (format.sub) props += '<w:vertAlign w:val="subscript"/>';
  return props ? `<w:rPr>${props}</w:rPr>` : '';
}

function textRun(text: string, format: Format): string {
  if (!text) return '';
  // Line breaks inside a run become <w:br/>.
  const pieces = text.split('\n').map(line => `<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`).join('<w:br/>');
  return `<w:r>${runProps(format)}${pieces}</w:r>`;
}

function base64Bytes(uri: string): Uint8Array | null {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/i.exec(uri);
  if (!match) return null;
  try {
    const binary = atob(match[1]);
    return Uint8Array.from(binary, ch => ch.charCodeAt(0));
  } catch { return null; }
}

function imageRun(image: HTMLImageElement, context: Context): string {
  const bytes = base64Bytes(image.getAttribute('src') ?? '');
  const size = bytes && imageSize(bytes);
  if (!bytes || !size || !size.width || !size.height) return textRun(image.alt, {});
  context.pictures.push({ bytes, ...size });
  const index = context.pictures.length - 1;
  return pictureXml(context.nextDrawing++, `rIdImg${index}`, context.pictures[index], image.alt);
}

function inline(node: Node, format: Format, context: Context): string {
  if (node.nodeType === Node.TEXT_NODE) return textRun(node.textContent ?? '', format);
  if (!(node instanceof HTMLElement)) return '';
  const tag = node.tagName.toLowerCase();
  switch (tag) {
    case 'br': return '<w:r><w:br/></w:r>';
    case 'img': return imageRun(node as HTMLImageElement, context);
    case 'input': return textRun((node as HTMLInputElement).checked ? '☑ ' : '☐ ', format);
    case 'math': {
      // Formulas stay as their TeX source when the renderer kept it.
      const source = node.querySelector('annotation')?.textContent;
      return textRun(source ?? node.textContent ?? '', { ...format, i: true });
    }
    case 'svg': return '';
    case 'a': {
      const href = node.getAttribute('href') ?? '';
      const inner = children(node, { ...format, link: true }, context);
      if (!/^(https?:|mailto:)/i.test(href)) return inner;
      context.links.push(href);
      return `<w:hyperlink r:id="rIdLink${context.links.length - 1}">${inner}</w:hyperlink>`;
    }
    default: {
      const next: Format = { ...format };
      if (tag === 'strong' || tag === 'b') next.b = true;
      if (tag === 'em' || tag === 'i') next.i = true;
      if (tag === 'del' || tag === 's') next.s = true;
      if (tag === 'code') next.code = true;
      if (tag === 'sup') next.sup = true;
      if (tag === 'sub') next.sub = true;
      if (tag === 'mark') next.mark = true;
      return children(node, next, context);
    }
  }
}

function children(element: Node, format: Format, context: Context): string {
  return Array.from(element.childNodes).map(child => inline(child, format, context)).join('');
}

function paragraph(content: string, options: { style?: string; list?: { id: number; level: number }} = {}): string {
  let props = '';
  if (options.style) props += `<w:pStyle w:val="${options.style}"/>`;
  if (options.list) props += `<w:numPr><w:ilvl w:val="${Math.min(options.list.level, 8)}"/><w:numId w:val="${options.list.id}"/></w:numPr>`;
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`;
}

interface Scope { quote: number; list?: { id: number; level: number } }

const BLOCK = new Set(['p', 'ul', 'ol', 'pre', 'blockquote', 'table', 'hr', 'div', 'section', 'details', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function blocks(parent: Node, context: Context, scope: Scope): string {
  let xml = '';
  let pending = '';
  const flush = () => {
    if (pending.trim()) xml += paragraph(pending, scopeOptions(scope));
    pending = '';
  };
  for (const child of Array.from(parent.childNodes)) {
    if (child instanceof HTMLElement && BLOCK.has(child.tagName.toLowerCase())) {
      flush();
      xml += block(child, context, scope);
    } else {
      pending += inline(child, {}, context);
    }
  }
  flush();
  return xml;
}

function scopeOptions(scope: Scope) {
  return { style: scope.quote ? 'Quote' : undefined, list: scope.list };
}

function listXml(list: HTMLElement, context: Context, scope: Scope): string {
  const ordered = list.tagName.toLowerCase() === 'ol';
  let id = 1;
  if (ordered) { context.orderedLists++; id = context.orderedLists + 1; }
  const level = scope.list ? scope.list.level + 1 : 0;
  let xml = '';
  for (const item of Array.from(list.children)) {
    if (item.tagName.toLowerCase() !== 'li') continue;
    const here: Scope = { ...scope, list: { id, level } };
    let lead = '';
    let nested = '';
    for (const child of Array.from(item.childNodes)) {
      if (child instanceof HTMLElement && ['ul', 'ol'].includes(child.tagName.toLowerCase())) nested += listXml(child, context, here);
      else if (child instanceof HTMLElement && child.tagName.toLowerCase() === 'p') lead += (lead ? '<w:r><w:br/></w:r>' : '') + children(child, {}, context);
      else if (child instanceof HTMLElement && BLOCK.has(child.tagName.toLowerCase())) nested += block(child, context, { ...scope, list: undefined });
      else lead += inline(child, {}, context);
    }
    xml += paragraph(lead, { style: scope.quote ? 'Quote' : undefined, list: here.list }) + nested;
  }
  return xml;
}

function tableXml(table: HTMLElement, context: Context): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  const columns = Math.max(1, ...rows.map(row => row.children.length));
  const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${Math.floor(9000 / columns)}"/>`).join('');
  const body = rows.map(row => {
    const cells = Array.from(row.children).map(cell => {
      const head = cell.tagName.toLowerCase() === 'th';
      const align = (cell as HTMLElement).style?.textAlign || cell.getAttribute('align') || '';
      const jc = align === 'center' ? '<w:jc w:val="center"/>' : align === 'right' ? '<w:jc w:val="right"/>' : '';
      const content = children(cell, head ? { b: true } : {}, context);
      return `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / columns)}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>' : ''}</w:tcPr><w:p><w:pPr><w:spacing w:after="40"/>${jc}</w:pPr>${content}</w:p></w:tc>`;
    });
    return `<w:tr>${cells.join('')}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>${paragraph('')}`;
}

function block(element: HTMLElement, context: Context, scope: Scope): string {
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return paragraph(children(element, {}, context), { style: `Heading${tag[1]}` });
  switch (tag) {
    case 'p': return paragraph(children(element, {}, context), scopeOptions(scope));
    case 'ul': case 'ol': return listXml(element, context, scope);
    case 'blockquote': return blocks(element, context, { ...scope, quote: scope.quote + 1 });
    case 'pre': {
      const lines = (element.textContent ?? '').replace(/\n$/, '').split('\n');
      return lines.map(line => paragraph(textRun(line || ' ', {}), { style: 'Code' })).join('') + paragraph('');
    }
    case 'table': return tableXml(element, context);
    case 'hr': return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C0C4CC"/></w:pBdr></w:pPr></w:p>';
    default:
      // A diagram or other drawing has no Word counterpart here; its source stays as code.
      if (element.dataset?.diagram !== undefined || element.querySelector('svg')) {
        const alt = element.getAttribute('aria-label') ?? '';
        return alt ? paragraph(textRun(alt, { i: true })) : '';
      }
      return blocks(element, context, scope);
  }
}

/** The .docx bytes for the rendered `<body>` HTML of a document. */
export function markdownToDocx(html: string): Uint8Array {
  const page = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const context: Context = { pictures: [], links: [], orderedLists: 0, nextDrawing: 1 };
  const body = blocks(page.body, context, { quote: 0 });
  return buildDocx({ body, pictures: context.pictures, links: context.links, orderedLists: context.orderedLists });
}
