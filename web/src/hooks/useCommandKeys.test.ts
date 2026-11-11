import { describe, expect, it, vi } from 'vitest';
import { commandForKeys, pressesKeys } from './useCommandKeys';
import type { Command } from '../store/commands';

const key = (init: Partial<KeyboardEvent> & { key: string; code?: string }) =>
  ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, code: '', ...init }) as KeyboardEvent;

describe('pressesKeys', () => {
  it('takes ⌘ or Ctrl as Ctrl, and needs exactly the listed modifiers', () => {
    expect(pressesKeys('Ctrl+S', key({ key: 's', metaKey: true }))).toBe(true);
    expect(pressesKeys('Ctrl+S', key({ key: 's', ctrlKey: true }))).toBe(true);
    expect(pressesKeys('Ctrl+S', key({ key: 'S', metaKey: true, shiftKey: true }))).toBe(false);
    expect(pressesKeys('Ctrl+Shift+S', key({ key: 'S', metaKey: true, shiftKey: true }))).toBe(true);
    expect(pressesKeys('Ctrl+P', key({ key: 'π', metaKey: true, altKey: true, code: 'KeyP' }))).toBe(false);
    expect(pressesKeys('Ctrl+S', key({ key: 's' }))).toBe(false);
  });

  it('finds a letter with ⌥ by its place, since ⌥ changes the character', () => {
    expect(pressesKeys('Ctrl+Alt+J', key({ key: '∆', code: 'KeyJ', metaKey: true, altKey: true }))).toBe(true);
  });

  it('finds a digit by its place, as AZERTY types digits with Shift', () => {
    expect(pressesKeys('Ctrl+2', key({ key: 'é', code: 'Digit2', metaKey: true }))).toBe(true);
    expect(pressesKeys('Ctrl+2', key({ key: '2', code: 'Numpad2', metaKey: true }))).toBe(false);
  });

  it('matches named keys and punctuation by the key', () => {
    expect(pressesKeys('Ctrl+Shift+Enter', key({ key: 'Enter', metaKey: true, shiftKey: true }))).toBe(true);
    expect(pressesKeys('Ctrl+,', key({ key: ',', metaKey: true }))).toBe(true);
  });
});

describe('commandForKeys', () => {
  const command = (id: string, keys: string | undefined, when?: () => boolean): Command => ({ id, name: id, keys, when, run: vi.fn() });

  it('takes the first available command with those keys', () => {
    const commands = [
      command('latex.exportPdf', 'Ctrl+Shift+E', () => false),
      command('typst.exportPdf', 'Ctrl+Shift+E', () => true),
      command('markdown.exportHtml', 'Ctrl+Shift+E', () => true),
    ];
    expect(commandForKeys(commands, key({ key: 'E', metaKey: true, shiftKey: true }))?.id).toBe('typst.exportPdf');
  });

  it('leaves a key no available command owns to the page, such as bold in Markdown', () => {
    const commands = [command('latex.compile', 'Ctrl+B', () => false), command('tab.close', undefined)];
    expect(commandForKeys(commands, key({ key: 'b', metaKey: true }))).toBeUndefined();
  });
});
