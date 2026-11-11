import { beforeEach, describe, expect, it, vi } from 'vitest';

const pending: Array<{ resolve: (value: unknown) => void }> = [];
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke }));

beforeEach(() => {
  pending.length = 0;
  invoke.mockReset();
  invoke.mockImplementation(() => new Promise(resolve => pending.push({ resolve })));
  (globalThis as unknown as { window: unknown }).window = {};
});

describe('references store', () => {
  it('keeps only the newest async index result', async () => {
    const { useReferencesStore } = await import('./references');
    useReferencesStore.getState().clear();
    const first = useReferencesStore.getState().refresh('C:/one', []);
    const second = useReferencesStore.getState().refresh('C:/two', []);
    pending[1].resolve({ occurrences: [], diagnostics: [{ code: 'new' }], scannedFiles: 1, truncated: false });
    await second;
    pending[0].resolve({ occurrences: [], diagnostics: [{ code: 'old' }], scannedFiles: 1, truncated: false });
    await first;
    expect(useReferencesStore.getState().result?.diagnostics[0].code).toBe('new');
  });

  it('sends dirty state with document overrides', async () => {
    const { useReferencesStore } = await import('./references');
    const run = useReferencesStore.getState().refresh('C:/paper', [{
      id: 't', title: 'main.typ', filePath: 'C:/paper/main.typ', lang: 'typst', content: '@x', isDirty: true,
    }]);
    expect(invoke).toHaveBeenCalledWith('index_references', {
      options: { root: 'C:/paper', documents: [{ path: 'C:/paper/main.typ', language: 'typst', text: '@x', isDirty: true }] },
    });
    pending.at(-1)!.resolve({ occurrences: [], diagnostics: [], scannedFiles: 1, truncated: false });
    await run;
  });
});
