import { useProjectStore } from '../store';
import { inside } from '../compile/project';

/** The backend confines image reads to this root: the open folder when the
 *  document is inside it, otherwise the document's own folder. */
export function imageReadRoot(documentPath: string): string {
  const folder = useProjectStore.getState().workspace?.root ?? useProjectStore.getState().folderPath;
  return inside(documentPath, folder) ? folder! : documentPath.replace(/[\\/][^\\/]*$/, '');
}

/** Bytes as base64, in chunks small enough for `String.fromCharCode`. */
export function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

// Relative Markdown images resolve against the saved document's folder; the
// backend (`asset_preview`) canonicalizes and confines the result.
export function localImagePath(href: string, documentPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(href.split(/[?#]/)[0]); } catch { return null; }
  if (!decoded || /[\u0000-\u001f]/.test(decoded) || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(decoded)) return null;
  return documentPath.replace(/[\\/][^\\/]*$/, '/') + decoded.replace(/\\/g, '/');
}
