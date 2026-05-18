// Command palette — extensible registry-driven implementation.
// Components/owners register commands via the `commands` store; the palette
// just renders & filters them. This decouples the palette from the rest of
// the app, unlike the legacy implementation which hardcoded the list inside
// the palette function.

import { create } from 'zustand';

export interface Command {
  /** Unique stable id, e.g. "file.open" */
  id: string;
  /** Human-readable label shown in the palette */
  name: string;
  /** Optional shortcut hint, e.g. "Ctrl+O" — display only, not bound */
  shortcut?: string;
  /** When true, command is enabled and shown */
  when?: () => boolean;
  /** Executed when user picks this command */
  run: () => void | Promise<void>;
}

interface CommandsStore {
  commands: Map<string, Command>;
  register: (cmd: Command) => () => void;
  unregister: (id: string) => void;
  list: () => Command[];
}

export const useCommandsStore = create<CommandsStore>((set, get) => ({
  commands: new Map(),
  register(cmd) {
    const next = new Map(get().commands);
    next.set(cmd.id, cmd);
    set({ commands: next });
    return () => get().unregister(cmd.id);
  },
  unregister(id) {
    const next = new Map(get().commands);
    next.delete(id);
    set({ commands: next });
  },
  list() {
    return Array.from(get().commands.values()).filter(c => !c.when || c.when());
  },
}));
