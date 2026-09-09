import { afterEach, describe, expect, it, vi } from 'vitest';
import { ipc } from '../api/tauri';
import { loadMarkdownImages, localImagePath, scrollToMarkdownHeading } from './markdownView';
vi.mock('../api/tauri', () => ({ ipc: { assetPreview: vi.fn() } }));
afterEach(() => vi.clearAllMocks());
function image(href: string) { return { dataset: { localImage: href } as Record<string, string>, src: '', alt: 'alt', title: '' }; }
function container(items: unknown[]) { return { querySelectorAll: () => items } as unknown as HTMLElement; }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
it('resolves images against the document, on macOS/Linux and Windows', () => {
  expect(localImagePath('images/a%20b.png', '/p/note.md')).toBe('/p/images/a b.png');
  expect(localImagePath('./fig.png', 'C:\\p\\note.md')).toBe('C:\\p/./fig.png');
  expect(localImagePath('../fig.png', '/p/chapters/note.md')).toBe('/p/chapters/../fig.png');
  expect(localImagePath('file:///etc/passwd', '/p/a.md')).toBeNull();
  expect(localImagePath('%00.png', '/p/a.md')).toBeNull();
});
describe('bounded local image loading', () => {
  it('reuses the authorized workspace, deduplicates reads and sets safe image data', async () => {
    vi.mocked(ipc.assetPreview).mockResolvedValue('data:image/png;base64,aA==');
    const a = image('../fig.png'), b = image('../fig.png');
    loadMarkdownImages(container([a, b]), '/p/chapters/note.md', '/p', true);
    await flush();
    expect(ipc.assetPreview).toHaveBeenCalledWith('/p', '/p/chapters/../fig.png');
    expect(ipc.assetPreview).toHaveBeenCalledTimes(1);
    expect(a.src).toBe('data:image/png;base64,aA==');
    expect(b.src).toBe(a.src);
  });
  it('reports unavailable/oversized files rather than leaving a perpetual loader', async () => {
    vi.mocked(ipc.assetPreview).mockResolvedValue(null);
    const a = image('huge.png');
    loadMarkdownImages(container([a]), '/p/note.md', null, true);
    await flush();
    expect(a.dataset.imageError).toBe('true');
    expect(a.title).toContain('2 MiB');
  });
  it('ignores an in-flight read after switching document', async () => {
    let resolve!: (value: string) => void;
    vi.mocked(ipc.assetPreview).mockImplementation(() => new Promise(done => { resolve = done; }));
    const a = image('fig.png');
    const stop = loadMarkdownImages(container([a]), '/p/note.md', '/p', true);
    stop(); resolve('data:image/png;base64,aA=='); await flush();
    expect(a.src).toBe('');
  });
  it('does not read relative images from unsaved documents', async () => {
    const a = image('fig.png');
    loadMarkdownImages(container([a]), null, '/p', true);
    await flush();
    expect(ipc.assetPreview).not.toHaveBeenCalled();
    expect(a.title).toContain('Save the document');
  });
});
it('Read outline scrolls the matching rendered heading', () => {
  const first = { dataset: { sourceLine: '1' }, scrollIntoView: vi.fn() };
  const second = { dataset: { sourceLine: '20' }, scrollIntoView: vi.fn() };
  scrollToMarkdownHeading(container([first, second]), 20);
  expect(second.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  expect(first.scrollIntoView).not.toHaveBeenCalled();
});
