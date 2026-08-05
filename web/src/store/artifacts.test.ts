import { beforeEach, describe, expect, it, vi } from 'vitest';
const pending: Array<{ resolve: (value: unknown) => void }> = [];
beforeEach(() => {
  pending.length = 0;
  (globalThis as unknown as { window: unknown }).window = { __TAURI__: {
    invoke: vi.fn(() => new Promise(resolve => pending.push({ resolve }))),
    event: { listen: vi.fn(), emit: vi.fn() },
  } };
});
describe('artifacts store', () => {
  it('keeps the newest refresh result', async () => {
    const { useArtifactsStore } = await import('./artifacts');
    useArtifactsStore.getState().clear();
    const first = useArtifactsStore.getState().refresh('C:/one');
    const second = useArtifactsStore.getState().refresh('C:/two');
    pending[1].resolve([{ name: 'new' }]); await second;
    pending[0].resolve([{ name: 'old' }]); await first;
    expect(useArtifactsStore.getState().items[0].name).toBe('new');
  });
});
