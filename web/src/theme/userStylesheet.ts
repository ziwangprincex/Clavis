// The user's own stylesheet, Typora's theme folder in one file
// (`<config_dir>/clavis/user.css`). It is injected after Clavis's own styles,
// so overriding the design tokens restyles the whole window; anything a token
// does not cover can still be reached by selector. Nothing here runs code.

import { ipc } from '../api/tauri';

const ID = 'clavis-user-stylesheet';

/** Applies `css`; an empty one removes the element again. */
export function applyUserStylesheet(css: string): void {
  const existing = document.getElementById(ID);
  if (!css.trim()) {
    existing?.remove();
    return;
  }
  const style = existing ?? Object.assign(document.createElement('style'), { id: ID });
  style.textContent = css;
  if (!existing) document.head.append(style);
}

/** Reads the file and applies it. Silently ignores a missing file. */
export async function loadUserStylesheet(): Promise<string> {
  const css = await ipc.readUserStylesheet();
  applyUserStylesheet(css);
  return css;
}
