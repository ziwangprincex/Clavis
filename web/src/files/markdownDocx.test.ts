// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markdownToDocx } from './markdownDocx';
import { crc32, imageSize } from './docxPackage';
import { markdownDocument } from '../render/markdown';

/** Stored entries of a ZIP, read back through its central directory. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(view.getUint32(at + 16, true));
    files.set(name, data);
    at += 46 + nameLength;
  }
  return files;
}

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==';

describe('markdown to docx', () => {
  const docx = (source: string) => {
    const files = unzip(markdownToDocx(markdownDocument(source).html));
    return { files, xml: new TextDecoder().decode(files.get('word/document.xml')) };
  };

  it('packs a readable package', () => {
    const { files } = docx('# 标题\n\nHello');
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml']) expect(files.has(part)).toBe(true);
  });

  it('keeps headings, inline styles and links', () => {
    const { files, xml } = docx('# 标题\n\nA **bold** and *italic* and `code` [site](https://example.com).');
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('标题');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:hyperlink r:id="rIdLink0">');
    expect(new TextDecoder().decode(files.get('word/_rels/document.xml.rels'))).toContain('https://example.com');
  });

  it('numbers each ordered list separately and nests lists', () => {
    const { xml } = docx('1. a\n2. b\n\ntext\n\n1. c\n\n- x\n  - y\n');
    expect(xml).toContain('<w:numId w:val="2"/>');
    expect(xml).toContain('<w:numId w:val="3"/>');
    expect(xml).toContain('<w:ilvl w:val="1"/>');
  });

  it('writes tables and code blocks', () => {
    const { xml } = docx('| a | b |\n|---|---|\n| 1 | 2 |\n\n```\nlet x = 1 < 2;\n```\n');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('w:val="Code"');
    expect(xml).toContain('let x = 1 &lt; 2;');
  });

  it('embeds data-URI images and sizes them from the header', () => {
    const bytes = Uint8Array.from(atob(PNG_1X1), ch => ch.charCodeAt(0));
    expect(imageSize(bytes)).toEqual({ ext: 'png', width: 1, height: 1 });
    const files = unzip(markdownToDocx(`<p><img src="data:image/png;base64,${PNG_1X1}" alt="dot"></p>`));
    expect(files.has('word/media/image0.png')).toBe(true);
    expect(new TextDecoder().decode(files.get('word/document.xml'))).toContain('r:embed="rIdImg0"');
  });
});
