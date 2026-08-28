export const isMac =
  typeof document !== 'undefined' && document.body.classList.contains('is-mac');

export function fmtShortcut(shortcut: string): string {
  if (!isMac) return shortcut;
  return shortcut
    .replace(/Ctrl\+Shift\+/g, '⌘⇧')
    .replace(/Ctrl\+Alt\+/g, '⌘⌥')
    .replace(/Ctrl\+/g, '⌘')
    .replace(/Alt\+/g, '⌥')
    .replace(/Shift\+/g, '⇧');
}
