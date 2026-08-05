import { create } from 'zustand';
import { events, ipc, type TaskRunFinished } from '../api/tauri';
import { useProjectStore } from './project';
import { setStatus } from './status';

export interface TaskLogLine {
  task: string;
  stream: 'stdout' | 'stderr' | 'info';
  text: string;
}

interface TaskStore {
  runId: string | null;
  requestedTask: string | null;
  plan: string[];
  activeTask: string | null;
  status: 'idle' | 'running' | 'ok' | 'error' | 'cancelled';
  lines: TaskLogLine[];
  result: TaskRunFinished | null;
  start: (task: string) => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
}

const MAX_TASK_LINES = 10_000;
let listenersReady: Promise<void> | null = null;

function append(line: TaskLogLine) {
  useTaskStore.setState(state => ({
    lines: [...state.lines.slice(-(MAX_TASK_LINES - 1)), line],
  }));
}

async function ensureListeners(): Promise<void> {
  if (listenersReady) return listenersReady;
  listenersReady = (async () => {
    await events.onTaskRunStarted(event => {
      useTaskStore.setState(state =>
        state.runId && state.runId !== event.runId
          ? state
          : {
              runId: event.runId,
              requestedTask: event.requestedTask,
              plan: event.plan,
              status: 'running',
              result: null,
            },
      );
    });
    await events.onTaskStepStarted(event => {
      if (event.runId !== useTaskStore.getState().runId) return;
      useTaskStore.setState({ activeTask: event.task });
      append({ task: event.task, stream: 'info', text: `$ ${event.command}` });
    });
    await events.onTaskOutput(event => {
      if (event.runId !== useTaskStore.getState().runId) return;
      append({ task: event.task, stream: event.stream, text: event.text });
    });
    await events.onTaskStepFinished(event => {
      if (event.runId !== useTaskStore.getState().runId) return;
      append({
        task: event.task,
        stream: event.ok ? 'info' : 'stderr',
        text: event.ok ? 'finished successfully' : event.reason ?? 'failed',
      });
    });
    await events.onTaskRunFinished(event => {
      if (event.runId !== useTaskStore.getState().runId) return;
      useTaskStore.setState({
        activeTask: null,
        status: event.cancelled ? 'cancelled' : event.ok ? 'ok' : 'error',
        result: event,
      });
      setStatus(
        event.cancelled
          ? `Task ${event.requestedTask} cancelled`
          : event.ok
            ? `Task ${event.requestedTask} completed`
            : `Task ${event.requestedTask} failed`,
        event.ok ? 'ok' : event.cancelled ? 'info' : 'error',
      );
    });
  })().catch(error => {
    listenersReady = null;
    throw error;
  });
  return listenersReady;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  runId: null,
  requestedTask: null,
  plan: [],
  activeTask: null,
  status: 'idle',
  lines: [],
  result: null,

  async start(task) {
    if (get().status === 'running') throw new Error('another project task is already running');
    const workspace = useProjectStore.getState().workspace;
    if (!workspace) throw new Error('open a workspace with clavis.toml first');
    if (workspace.trust !== 'trusted') throw new Error('workspace is not trusted for task execution');
    await ensureListeners();
    set({
      runId: null,
      requestedTask: task,
      plan: [],
      activeTask: null,
      status: 'running',
      lines: [],
      result: null,
    });
    try {
      const started = await ipc.startProjectTask(workspace.root, task);
      set(state => ({
        ...state,
        runId: started.runId,
        requestedTask: started.requestedTask,
        plan: started.plan,
      }));
      setStatus(`Running task ${task}…`, 'info');
    } catch (error) {
      set({ status: 'error', activeTask: null });
      setStatus(`Task ${task} failed to start`, 'error');
      throw error;
    }
  },

  async cancel() {
    const runId = get().runId;
    if (!runId || get().status !== 'running') return;
    await ipc.cancelProjectTask(runId);
    setStatus(`Cancelling task ${get().requestedTask ?? ''}…`, 'info');
  },

  clear() {
    if (get().status === 'running') return;
    set({ runId: null, requestedTask: null, plan: [], activeTask: null, status: 'idle', lines: [], result: null });
  },
}));
