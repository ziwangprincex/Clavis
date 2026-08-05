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
  startRender: (options: { root: string; document: string; tool: 'quarto' | 'pandoc'; format: 'html' | 'pdf' | 'docx' }) => Promise<void>;
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
      useTaskStore.setState(state => {
        if (state.runId && state.runId !== event.runId) return state;
        // The backend can emit this before the start IPC resolves. Accept it
        // only for the run currently being requested so early output is not lost.
        if (!state.runId && state.requestedTask !== event.requestedTask) return state;
        return {
          runId: event.runId,
          requestedTask: event.requestedTask,
          plan: event.plan,
          status: 'running',
          result: null,
        };
      });
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

async function prepareRun(set: (state: Partial<TaskStore>) => void, get: () => TaskStore, requestedTask: string): Promise<void> {
  if (get().status === 'running') throw new Error('another project task is already running');
  await ensureListeners();
  set({ runId: null, requestedTask, plan: [], activeTask: null, status: 'running', lines: [], result: null });
}

function acceptStarted(set: (state: Partial<TaskStore>) => void, started: { runId: string; requestedTask: string; plan: string[] }) {
  set({ runId: started.runId, requestedTask: started.requestedTask, plan: started.plan });
  setStatus(`Running ${started.requestedTask}?`, 'info');
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
    const workspace = useProjectStore.getState().workspace;
    if (!workspace) throw new Error('open a workspace with clavis.toml first');
    if (workspace.trust !== 'trusted') throw new Error('workspace is not trusted for task execution');
    await prepareRun(set, get, task);
    try {
      acceptStarted(set, await ipc.startProjectTask(workspace.root, task));
    } catch (error) {
      set({ status: 'error', activeTask: null });
      setStatus(`Task ${task} failed to start`, 'error');
      throw error;
    }
  },

  async startRender(options) {
    const label = `render:${options.tool}:${options.format}`;
    await prepareRun(set, get, label);
    try {
      acceptStarted(set, await ipc.startDocumentRender(options));
    } catch (error) {
      set({ status: 'error', activeTask: null });
      setStatus(`Render failed to start`, 'error');
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
