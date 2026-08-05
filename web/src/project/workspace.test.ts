import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceInspection } from '../api/tauri';
import { inspectAndMaybeTrustWorkspace, workspaceProjectName } from './workspace';

function inspection(patch: Partial<WorkspaceInspection> = {}): WorkspaceInspection {
  return {
    root: 'C:/paper',
    configPath: 'C:/paper/clavis.toml',
    config: {
      project: { name: 'Paper', main: 'paper/main.tex' },
      latex: {},
      paths: { generated: [], ignored: [] },
      tasks: {},
    },
    issues: [],
    trust: 'not-required',
    hasExecutableTasks: false,
    ...patch,
  };
}

describe('workspace project trust orchestration', () => {
  it('does not prompt when the project has no executable tasks', async () => {
    const adapter = {
      inspectWorkspace: vi.fn().mockResolvedValue(inspection()),
      setWorkspaceTrust: vi.fn(),
    };
    const confirm = vi.fn();
    const result = await inspectAndMaybeTrustWorkspace('C:/paper', adapter, confirm);

    expect(result.trust).toBe('not-required');
    expect(confirm).not.toHaveBeenCalled();
    expect(adapter.setWorkspaceTrust).not.toHaveBeenCalled();
  });

  it('keeps task execution untrusted when the user declines', async () => {
    const original = inspection({ trust: 'untrusted', hasExecutableTasks: true });
    const adapter = {
      inspectWorkspace: vi.fn().mockResolvedValue(original),
      setWorkspaceTrust: vi.fn(),
    };
    const result = await inspectAndMaybeTrustWorkspace('C:/paper', adapter, async () => false);

    expect(result).toBe(original);
    expect(adapter.setWorkspaceTrust).not.toHaveBeenCalled();
  });

  it('stores trust separately only after explicit confirmation', async () => {
    const adapter = {
      inspectWorkspace: vi.fn().mockResolvedValue(
        inspection({ trust: 'untrusted', hasExecutableTasks: true }),
      ),
      setWorkspaceTrust: vi.fn().mockResolvedValue({ root: 'C:/paper', trust: 'trusted' }),
    };
    const result = await inspectAndMaybeTrustWorkspace('C:/paper', adapter, async () => true);

    expect(adapter.setWorkspaceTrust).toHaveBeenCalledWith('C:/paper', true);
    expect(result.trust).toBe('trusted');
  });

  it('does not request trust for an invalid task graph', async () => {
    const adapter = {
      inspectWorkspace: vi.fn().mockResolvedValue(
        inspection({
          trust: 'untrusted',
          hasExecutableTasks: true,
          issues: ['task dependency graph contains a cycle'],
        }),
      ),
      setWorkspaceTrust: vi.fn(),
    };
    const confirm = vi.fn();
    await inspectAndMaybeTrustWorkspace('C:/paper', adapter, confirm);

    expect(confirm).not.toHaveBeenCalled();
  });

  it('returns the configured project name when present', () => {
    expect(workspaceProjectName(inspection())).toBe('Paper');
    expect(workspaceProjectName(inspection({ config: null }))).toBeNull();
  });
});
