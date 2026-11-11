// From the user agent, as main.tsx sets `is-mac` from it: this module is
// evaluated before that class is added, so the class cannot be read here.
export const isMac =
  typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac');

export function fmtShortcut(shortcut: string): string {
  if (!isMac) return shortcut;
  return shortcut
    .replace(/Ctrl\+Shift\+/g, '⌘⇧')
    .replace(/Ctrl\+Alt\+/g, '⌘⌥')
    .replace(/Ctrl\+/g, '⌘')
    .replace(/Alt\+/g, '⌥')
    .replace(/Shift\+/g, '⇧');
}
