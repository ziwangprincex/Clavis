import { ipc } from '../api/tauri';
import { t } from '../i18n';

export function scrollToMarkdownHeading(container: HTMLElement, line: number): void {
  const headings = Array.from(container.querySelectorAll<HTMLElement>('[data-source-line]'));
  const heading = headings.find(item => Number(item.dataset.sourceLine) >= line) ?? headings.at(-1);
  heading?.scrollIntoView({ block: 'start', behavior: 'auto' });
}

export function localImagePath(href: string, documentPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(href.split(/[?#]/)[0]); } catch { return null; }
  if (!decoded || /[\u0000-\u001f]/.test(decoded) || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(decoded)) return null;
  return documentPath.replace(/[\\/][^\\/]*$/, '/') + decoded.replace(/\\/g, '/');
}

/** Backend canonicalizes paths, rejects workspace escapes and bounds image size. */
export function loadMarkdownImages(container: HTMLElement, documentPath: string | null, workspace: string | null, native: boolean): () => void {
  let alive = true;
  const images = Array.from(container.querySelectorAll<HTMLImageElement>('img[data-local-image]'));
  async function load() {
    // Sequential requests keep a large Markdown document from flooding native workers.
    const cache = new Map<string, string | null>();
    for (const image of images) {
      if (!alive) return;
      const href = image.dataset.localImage!;
      const path = documentPath ? localImagePath(href, documentPath) : null;
      const root = workspace || documentPath?.replace(/[\\/][^\\/]*$/, '');
      try {
        if (!native || !path || !root) throw new Error('No local image root');
        if (!cache.has(path)) cache.set(path, await ipc.assetPreview(root, path));
        if (!alive) return;
        const data = cache.get(path);
        if (!data?.startsWith('data:image/')) throw new Error('Unsupported or oversized image');
        image.src = data;
        delete image.dataset.imageError;
      } catch {
        if (!alive) return;
        image.dataset.imageError = 'true';
        image.alt = t('Image unavailable: {path}', { path: href });
        image.title = t(documentPath ? 'Local images must be inside the document folder or open workspace and at most 2 MiB.' : 'Save the document to resolve relative images.');
      }
    }
  }
  void load();
  return () => { alive = false; };
}
