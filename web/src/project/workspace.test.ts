import { describe, expect, it } from 'vitest';
import type { WorkspaceInspection } from '../api/tauri';
import { workspaceProjectName } from './workspace';

function inspection(patch: Partial<WorkspaceInspection> = {}): WorkspaceInspection {
  return {
    root: 'C:/paper',
    configPath: 'C:/paper/clavis.toml',
    config: {
      project: { name: 'Paper', main: 'paper/main.tex' },
      latex: {},
      paths: { generated: [], ignored: [] },
    },
    issues: [],
    ...patch,
  };
}

describe('workspace project metadata', () => {
  it('returns the configured project name when present', () => {
    expect(workspaceProjectName(inspection())).toBe('Paper');
    expect(workspaceProjectName(inspection({ config: null }))).toBeNull();
  });
});
