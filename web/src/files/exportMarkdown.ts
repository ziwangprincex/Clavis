// Markdown export as one self-contained HTML file, as Typora's File → Export →
// HTML. Local images are embedded and diagrams drawn as SVG, so the file can be
// moved, mailed or printed to PDF from a browser on its own.

import { dialogSave, hasTauri, ipc } from '../api/tauri';
import { escapeAttr, markdownDocument } from '../render/markdown';
import { base64, imageReadRoot, localImagePath } from '../render/markdownView';
import { drawDiagram } from '../editor/mermaidDiagram';
import { setStatus } from '../store/status';
import type { Tab } from '../store';

const STYLE = `
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #24292f; font: 17px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
article { max-width: 44em; margin: 0 auto; padding: 56px 24px 96px; }
h1, h2, h3, h4, h5, h6 { line-height: 1.35; margin: 1.6em 0 0.6em; font-weight: 600; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.2em; }
a { color: #0b62c4; }
img, svg { max-width: 100%; height: auto; }
p > img:only-child { display: block; margin: 0.4em auto; }
code { font: 0.88em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f2f3f5; border-radius: 4px; padding: 0.1em 0.3em; }
pre { background: #f6f7f9; border-radius: 6px; padding: 0.8em 1em; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 1em 0; padding: 0 1em; border-left: 3px solid #d0d4da; color: #57606a; }
.callout { color: inherit; }
.callout-title { font-weight: 600; margin-bottom: 0; }
.callout-note, .callout-important { border-left-color: #0b62c4; } .callout-note .callout-title, .callout-important .callout-title { color: #0b62c4; }
.callout-tip { border-left-color: #1a7f37; } .callout-tip .callout-title { color: #1a7f37; }
.callout-warning { border-left-color: #9a6700; } .callout-warning .callout-title { color: #9a6700; }
.callout-caution { border-left-color: #cf222e; } .callout-caution .callout-title { color: #cf222e; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { padding: 0.35em 0.9em; border-bottom: 1px solid #d8dee4; }
th { border-bottom-color: #afb8c1; }
mark { background: #fff1b8; padding: 0.05em 0; }
hr { border: none; border-top: 1px solid #d0d4da; margin: 2em 0; }
li > input[type=checkbox] { margin-right: 0.4em; }
math[display=block] { margin: 0.6em 0; }
.diagram { text-align: center; margin: 1em 0; }
.footnotes { margin-top: 3em; padding-top: 1em; border-top: 1px solid #d0d4da; font-size: 0.9em; color: #57606a; }
@media print { article { padding: 0; } a { color: inherit; } }
`;

/** The rendered body with local images embedded and diagrams drawn. Images
 *  outside the readable root, or missing, keep their alt text. */
async function complete(html: string, documentPath: string): Promise<string> {
  const page = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const root = imageReadRoot(documentPath);
  for (const image of page.querySelectorAll<HTMLImageElement>('img[data-local-image]')) {
    const path = localImagePath(image.dataset.localImage!, documentPath);
    const data = path ? await ipc.assetPreview(root, path).catch(() => null) : null;
    image.removeAttribute('data-local-image');
    if (data?.startsWith('data:image/')) image.src = data;
    else image.replaceWith(page.createTextNode(image.alt));
  }
  for (const diagram of page.querySelectorAll<HTMLElement>('div[data-diagram]')) {
    const source = diagram.dataset.diagram!;
    diagram.removeAttribute('data-diagram');
    try {
      diagram.innerHTML = await drawDiagram(source, false);
    } catch {
      const pre = page.createElement('pre');
      pre.textContent = source;
      diagram.replaceWith(pre);
    }
  }
  return page.body.innerHTML;
}

export async function exportMarkdownHtml(tab: Tab, language: string): Promise<void> {
  if (!hasTauri()) return;
  if (!tab.filePath) {
    setStatus('Save the document first: images are stored beside it.', 'error');
    return;
  }
  const target = await dialogSave({
    defaultPath: tab.filePath.replace(/\.[^./\\]+$/, '') + '.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (typeof target !== 'string') return;
  try {
    setStatus('Exporting HTML…', 'info');
    const { title, html } = markdownDocument(tab.content);
    const body = await complete(html, tab.filePath);
    const name = title || tab.title.replace(/\.[^.]+$/, '');
    const file = `<!doctype html>\n<html lang="${escapeAttr(language)}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n`
      + `<title>${escapeAttr(name)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n<article>\n${body}\n</article>\n</body>\n</html>\n`;
    await ipc.saveBinaryFile(target, base64(new TextEncoder().encode(file)));
    setStatus('HTML exported', 'ok');
  } catch (error) {
    console.error('export HTML failed', error);
    setStatus('Export failed', 'error');
  }
}
