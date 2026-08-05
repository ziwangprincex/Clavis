import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls: Array<{ cmd: string }> = [];
let statusResult: unknown;

beforeEach(() => {
  calls.length = 0;
  statusResult = { root: 'C:/work', isRepository: false, detached: false, ahead: 0, behind: 0, files: [] };
  (globalThis as unknown as { window: unknown }).window = { __TAURI__: {
    invoke: vi.fn(async (cmd: string) => {
      calls.push({ cmd });
      if (cmd === 'inspect_git_workspace') return statusResult;
      if (cmd === 'git_history') return [];
      if (cmd === 'git_file_diff') return '';
      return null;
    }), event: { listen: vi.fn(), emit: vi.fn() },
  } };
});

describe('git store', () => {
  it('treats a non-repository workspace as a normal empty state', async () => {
    const { useGitStore } = await import('./git');
    await useGitStore.getState().refresh('C:/work');
    expect(useGitStore.getState().status?.isRepository).toBe(false);
    expect(useGitStore.getState().error).toBeNull();
    expect(calls.map(call => call.cmd)).toEqual(['inspect_git_workspace']);
  });

  it('loads history only for repositories', async () => {
    statusResult = { root: 'C:/work', isRepository: true, branch: 'main', detached: false, ahead: 0, behind: 0, files: [] };
    const { useGitStore } = await import('./git');
    await useGitStore.getState().refresh('C:/work');
    expect(calls.map(call => call.cmd)).toEqual(['inspect_git_workspace', 'git_history']);
  });
});
