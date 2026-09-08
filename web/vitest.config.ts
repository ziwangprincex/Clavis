import { defineConfig } from 'vitest/config';

// Pure logic and react-test-renderer lifecycle tests run without a browser/DOM.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
