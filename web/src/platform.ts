// From the user agent, as main.tsx sets `is-mac` from it: this module is
// evaluated before that class is added, so the class cannot be read here.
/** The macOS main window shows the system's sidebar material (main.tsx). */
export const vibrantWindow = () => typeof document !== 'undefined' && !!document.documentElement?.classList.contains('vibrant');

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
