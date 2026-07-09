import { defineConfig } from 'vitest/config';

// Unit tests target pure logic (outline parsing, store reducers, session
// snapshotting) — no DOM required, so the fast `node` environment is enough.
// Component/DOM tests would need environment: 'jsdom' and can be added later.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
