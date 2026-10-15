// Where a Markdown document's pasted and dropped images go. The setting picks
// a folder relative to the document (Typora's choices: `assets`, the document's
// own `${filename}.assets`, or the document's folder); a document can choose its
// own in its front matter with Typora's `typora-copy-images-to`, or
// `image-folder`. The backend keeps the folder inside the workspace.

import { frontmatterLength } from '../editor/markdownFrontmatter';
import { useSettingsStore } from '../store';
import { imageReadRoot } from '../render/markdownView';

const KEY = /^(?:typora-copy-images-to|image-folder)[ \t]*:[ \t]*(.*?)[ \t]*$/m;

/** The image folder a document's front matter asks for, or null. */
export function frontmatterImageFolder(content: string): string | null {
  const length = frontmatterLength(content);
  if (!length) return null;
  const value = KEY.exec(content.slice(0, length))?.[1].replace(/^(['"])(.*)\1$/, '$2').trim();
  return value ? value : null;
}

/** The folder (relative to the document) and the workspace limit for saving images. */
export function imageTarget(documentPath: string, content: string): { folder: string; root: string } {
  const setting = useSettingsStore.getState().settings.markdown_image_folder || 'assets';
  return { folder: frontmatterImageFolder(content) ?? setting, root: imageReadRoot(documentPath) };
}
