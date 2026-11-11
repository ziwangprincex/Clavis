import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

// main.tsx imports the app, and with it this module, before it adds `is-mac` to the body.
it('knows a Mac before the body has been marked', async () => {
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' });
  vi.stubGlobal('document', { body: { classList: { contains: () => false } } });
  const { isMac, fmtShortcut } = await import('./platform');
  expect(isMac).toBe(true);
  expect(fmtShortcut('Ctrl+Shift+L')).toBe('⌘⇧L');
});
