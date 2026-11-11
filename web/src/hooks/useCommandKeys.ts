// Keyboard shortcuts come from the command list: a command's `keys` is both
// the shortcut the palette shows and the key that runs it, so the two cannot
// drift apart. Keys bound elsewhere (the macOS menu, the editor's keymap) stay
// display-only `shortcut` hints on their commands.

import { useEffect } from 'react';
import { useCommandsStore, type Command } from '../store/commands';

/**
 * Whether a key event presses `keys`, written like "Ctrl+Shift+E": Ctrl is ⌘
 * on macOS, and either key counts as it elsewhere.
 */
export function pressesKeys(keys: string, event: KeyboardEvent): boolean {
  const parts = keys.split('+');
  const key = parts.pop() ?? '';
  const alt = parts.includes('Alt');
  if ((event.metaKey || event.ctrlKey) !== parts.includes('Ctrl')) return false;
  if (event.shiftKey !== parts.includes('Shift') || event.altKey !== alt) return false;
  // A digit by its place: on AZERTY the digits themselves need Shift.
  if (/^\d$/.test(key)) return event.code === `Digit${key}`;
  // A letter by its character, except with ⌥, which changes the character on macOS.
  if (/^[a-z]$/i.test(key)) return alt ? event.code === `Key${key.toUpperCase()}` : event.key.toLowerCase() === key.toLowerCase();
  return event.key === key;
}

/** The first available command whose keys the event presses. */
export function commandForKeys(commands: Iterable<Command>, event: KeyboardEvent): Command | undefined {
  for (const command of commands) {
    if (command.keys && pressesKeys(command.keys, event) && (command.when?.() ?? true)) return command;
  }
  return undefined;
}

function inDialog(event: KeyboardEvent): boolean {
  return event.target instanceof Element && !!event.target.closest('[role="dialog"]');
}

function inText(event: KeyboardEvent): boolean {
  return event.target instanceof HTMLElement && (event.target.isContentEditable || !!event.target.closest('input, textarea'));
}

/**
 * The window's key handler. It runs after the editor, so a key the editor
 * took (bold in Markdown, a heading level) arrives already handled.
 */
export function useCommandKeys(openPalette: () => void): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || inDialog(event)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        openPalette();
        return;
      }
      const command = commandForKeys(useCommandsStore.getState().commands.values(), event);
      if (command) {
        event.preventDefault();
        void command.run();
      } else if (mod && !event.shiftKey && event.key.toLowerCase() === 'a' && !inText(event)) {
        // Outside text, Select All would highlight every label in the window.
        event.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette]);
}
