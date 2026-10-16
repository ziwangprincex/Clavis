// The user's own stylesheet, Typora's theme folder in one file
// (`<config_dir>/clavis/user.css`). It is injected after Clavis's own styles,
// so overriding the design tokens restyles the whole window; anything a token
// does not cover can still be reached by selector. Nothing here runs code.

import { hasTauri, ipc } from '../api/tauri';

const ID = 'clavis-user-stylesheet';

/** Applies `css`; an empty one removes the element again. */
export function applyUserStylesheet(css: string): void {
  // Tests run without a DOM; there is nothing to inject there.
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(ID);
  if (!css.trim()) {
    existing?.remove();
    return;
  }
  const style = existing ?? Object.assign(document.createElement('style'), { id: ID });
  style.textContent = css;
  if (!existing) document.head.append(style);
}

/** Reads the file and applies it. Outside the app shell there is nothing to read. */
export async function loadUserStylesheet(): Promise<string> {
  if (!hasTauri()) return '';
  const css = await ipc.readUserStylesheet();
  applyUserStylesheet(css);
  return css;
}
