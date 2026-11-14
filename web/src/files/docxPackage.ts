// A minimal .docx writer: WordprocessingML built from the rendered Markdown
// DOM, packed in an uncompressed ZIP. No dependency, nothing runs code.

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { path: string; data: Uint8Array }

/** A ZIP with every entry stored (method 0), which every reader accepts. */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (bytes: Uint8Array) => { parts.push(bytes); offset += bytes.length; };
  for (const { path, data } of entries) {
    const name = encoder.encode(path);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    push(new Uint8Array(local.buffer));
    push(name);
    push(data);
  }
  const start = offset;
  for (const part of central) push(part);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, offset - start, true);
  end.setUint32(16, start, true);
  push(new Uint8Array(end.buffer));
  const out = new Uint8Array(offset);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

export function xmlEscape(text: string): string {
  return text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
    // XML 1.0 forbids the control characters other than tab, line feed and carriage return.
    .replace(/[^\t\n\r\u0020-\uffff]/gu, char => (char.codePointAt(0)! > 0xffff ? char : ''));
}

export interface Picture { bytes: Uint8Array; ext: 'png' | 'jpeg' | 'gif'; width: number; height: number }

/** Pixel size of a PNG, JPEG or GIF from its header; null when unreadable. */
export function imageSize(bytes: Uint8Array): { ext: Picture['ext']; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && view.getUint32(0) === 0x89504e47) {
    return { ext: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { ext: 'gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) { at++; continue; }
      const marker = bytes[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { ext: 'jpeg', height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
      }
      at += 2 + view.getUint16(at + 2);
    }
  }
  return null;
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const MAX_WIDTH_EMU = 5_760_000; // 16 cm: the text width of an A4 page with 2.5 cm margins
const EMU_PER_PX = 9525;

export function pictureXml(id: number, rel: string, picture: Picture, alt: string): string {
  let width = picture.width * EMU_PER_PX;
  let height = picture.height * EMU_PER_PX;
  if (width > MAX_WIDTH_EMU) { height = Math.round(height * MAX_WIDTH_EMU / width); width = MAX_WIDTH_EMU; }
  const name = xmlEscape(alt);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${name}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function styles(): string {
  const heading = (level: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PingFang SC" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
    + [[1, 40], [2, 32], [3, 28], [4, 24], [5, 22], [6, 22]].map(([level, size]) => heading(level, size)).join('')
    + `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C0C4CC"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:color w:val="57606A"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:spacing w:after="0" w:line="260" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:cs="Menlo"/><w:sz w:val="19"/></w:rPr></w:style>`
    + `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0B62C4"/><w:u w:val="single"/></w:rPr></w:style>`
    + `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFC5CC"/><w:left w:val="single" w:sz="4" w:color="BFC5CC"/><w:bottom w:val="single" w:sz="4" w:color="BFC5CC"/><w:right w:val="single" w:sz="4" w:color="BFC5CC"/><w:insideH w:val="single" w:sz="4" w:color="BFC5CC"/><w:insideV w:val="single" w:sz="4" w:color="BFC5CC"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
}

function numbering(orderedCount: number): string {
  const levels = (format: string, text: (i: number) => string) =>
    Array.from({ length: 9 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text(i)}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>`
    + `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels('bullet', () => '')}</w:abstractNum>`
    + `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${levels('decimal', i => `%${i + 1}.`)}</w:abstractNum>`
    + `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>`;
  // Each ordered list is its own instance so numbering restarts.
  for (let i = 0; i < orderedCount; i++) {
    xml += `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;
  }
  return xml + '</w:numbering>';
}

export interface DocxParts {
  body: string;
  pictures: Picture[];
  links: string[];
  orderedLists: number;
}

export function buildDocx(parts: DocxParts): Uint8Array {
  const text = (value: string) => encoder.encode(value);
  const entries: ZipEntry[] = [];
  const rels = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
    ...parts.links.map((url, i) => `<Relationship Id="rIdLink${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(url)}" TargetMode="External"/>`),
    ...parts.pictures.map((picture, i) => `<Relationship Id="rIdImg${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i}.${picture.ext === 'jpeg' ? 'jpg' : picture.ext}"/>`),
  ];
  entries.push(
    { path: '[Content_Types].xml', data: text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>') },
    { path: '_rels/.rels', data: text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { path: 'word/document.xml', data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${parts.body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`) },
    { path: 'word/_rels/document.xml.rels', data: text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`) },
    { path: 'word/styles.xml', data: text(styles()) },
    { path: 'word/numbering.xml', data: text(numbering(parts.orderedLists)) },
  );
  parts.pictures.forEach((picture, i) => entries.push({ path: `word/media/image${i}.${picture.ext === 'jpeg' ? 'jpg' : picture.ext}`, data: picture.bytes }));
  return zipStore(entries);
}
