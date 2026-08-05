import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from './project';

const listeners: Record<string, (payload: unknown) => void> = {};
const invokes: Array<{ cmd: string; args: Record<string, unknown> | undefined }> = [];

beforeEach(() => {
  invokes.length = 0;
  (globalThis as unknown as { window: unknown }).window = {
    __TAURI__: {
      invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
        invokes.push({ cmd, args });
        if (cmd === 'start_project_task') {
          return { runId: 'run-1', requestedTask: 'paper', plan: ['tables', 'paper'] };
        }
        if (cmd === 'cancel_project_task') return true;
        return null;
      }),
      event: {
        listen: vi.fn(async (event: string, handler: (e: { payload: unknown }) => void) => {
          listeners[event] = payload => handler({ payload });
          return () => { delete listeners[event]; };
        }),
        emit: vi.fn(),
      },
    },
  };
  useProjectStore.setState({
    workspace: {
      root: 'C:/paper',
      configPath: 'C:/paper/clavis.toml',
      config: {
        project: {}, latex: {}, paths: { generated: [], ignored: [] },
        tasks: { paper: { command: 'latexmk', args: [], env: {}, dependsOn: [] } },
      },
      issues: [], trust: 'trusted', hasExecutableTasks: true,
    },
  });
});

describe('project task store', () => {
  it('subscribes before starting so early events are not missed', async () => {
    const { useTaskStore } = await import('./tasks');
    useTaskStore.getState().clear();
    await useTaskStore.getState().start('paper');

    expect(Object.keys(listeners)).toContain('task-output');
    expect(invokes[0]).toEqual({
      cmd: 'start_project_task',
      args: { root: 'C:/paper', task: 'paper' },
    });
    expect(useTaskStore.getState().plan).toEqual(['tables', 'paper']);
  });

  it('ignores output from a different run and records the current run', async () => {
    const { useTaskStore } = await import('./tasks');
    useTaskStore.setState({ runId: null, status: 'idle', lines: [] });
    await useTaskStore.getState().start('paper');

    listeners['task-output']?.({ runId: 'old', task: 'paper', stream: 'stdout', text: 'stale' });
    listeners['task-output']?.({ runId: 'run-1', task: 'paper', stream: 'stdout', text: 'fresh' });
    expect(useTaskStore.getState().lines.map(line => line.text)).toEqual(['fresh']);
  });

  it('cancels the active run through the backend', async () => {
    const { useTaskStore } = await import('./tasks');
    useTaskStore.setState({ runId: null, status: 'idle', lines: [] });
    await useTaskStore.getState().start('paper');
    await useTaskStore.getState().cancel();

    expect(invokes.at(-1)).toEqual({
      cmd: 'cancel_project_task',
      args: { runId: 'run-1' },
    });
  });

  it('refuses untrusted workspaces before IPC', async () => {
    const { useTaskStore } = await import('./tasks');
    useTaskStore.setState({ runId: null, status: 'idle', lines: [] });
    useProjectStore.setState(state => ({
      workspace: state.workspace && { ...state.workspace, trust: 'untrusted' },
    }));

    await expect(useTaskStore.getState().start('paper')).rejects.toThrow('not trusted');
    expect(invokes).toHaveLength(0);
  });
});
