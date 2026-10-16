// The user's own stylesheet, Typora's theme folder in one file
// (`<config_dir>/clavis/user.css`). It is injected after Clavis's own styles,
// so overriding the design tokens restyles the whole window; anything a token
// does not cover can still be reached by selector. Nothing here runs code.

import { managedStyleElement } from './managedStylesheet';
import { hasTauri, ipc } from '../api/tauri';

export const USER_STYLESHEET_ID = 'clavis-user-stylesheet';

/** Applies `css`; an empty one removes the element again. */
export function applyUserStylesheet(css: string): void {
  // Tests run without a DOM; there is nothing to inject there.
  if (typeof document === 'undefined') return;
  if (!css.trim()) {
    document.getElementById(USER_STYLESHEET_ID)?.remove();
    return;
  }
  // No beforeId: the user stylesheet must come last. Startup guarantees the
  // order anyway — useAppTheme writes the token rule before this is loaded.
  const style = managedStyleElement(USER_STYLESHEET_ID);
  if (style) style.textContent = css;
}

/** Reads the file and applies it. Outside the app shell there is nothing to read. */
export async function loadUserStylesheet(): Promise<string> {
  if (!hasTauri()) return '';
  const css = await ipc.readUserStylesheet();
  applyUserStylesheet(css);
  return css;
}
