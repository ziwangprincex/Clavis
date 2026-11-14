// A switchable theme: one `*.css` file in `<config_dir>/clavis/themes`, chosen
// in Settings → Appearance. It lands ahead of the user stylesheet, so user.css
// still has the last word. Like user.css it is plain CSS; nothing here runs code.

import { managedStyleElement } from './managedStylesheet';
import { USER_STYLESHEET_ID } from './userStylesheet';
import { hasTauri, ipc } from '../api/tauri';

export const USER_THEME_ID = 'clavis-user-theme';
const STORAGE_KEY = 'clavis.theme';

export function selectedTheme(): string {
  try { return localStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
}

function remember(name: string): void {
  try {
    if (name) localStorage.setItem(STORAGE_KEY, name);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable: the choice lasts until restart */ }
}

export function applyTheme(css: string): void {
  if (typeof document === 'undefined') return;
  if (!css.trim()) {
    document.getElementById(USER_THEME_ID)?.remove();
    return;
  }
  const style = managedStyleElement(USER_THEME_ID, USER_STYLESHEET_ID);
  if (style) style.textContent = css;
}

/** Applies the named theme ('' for none) and remembers it. A missing file clears the choice. */
export async function selectTheme(name: string): Promise<void> {
  if (!hasTauri()) return;
  if (!name) { remember(''); applyTheme(''); return; }
  try {
    applyTheme(await ipc.readTheme(name));
    remember(name);
  } catch (error) {
    remember('');
    applyTheme('');
    throw error;
  }
}

export async function loadSelectedTheme(): Promise<void> {
  const name = selectedTheme();
  if (name) await selectTheme(name).catch(() => {});
}
