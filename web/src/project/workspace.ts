import type { WorkspaceInspection, WorkspaceTrust } from '../api/tauri';

export interface WorkspaceProjectAdapter {
  inspectWorkspace(root: string): Promise<WorkspaceInspection>;
  setWorkspaceTrust(root: string, trusted: boolean): Promise<WorkspaceTrust>;
}

export type ConfirmWorkspaceTrust = (inspection: WorkspaceInspection) => Promise<boolean>;

/**
 * Load repository-owned project metadata, then optionally grant user-owned
 * execution trust. Merely opening or parsing `clavis.toml` never runs a task.
 */
export async function inspectAndMaybeTrustWorkspace(
  root: string,
  adapter: WorkspaceProjectAdapter,
  confirmTrust: ConfirmWorkspaceTrust,
): Promise<WorkspaceInspection> {
  const inspection = await adapter.inspectWorkspace(root);
  if (
    inspection.trust !== 'untrusted' ||
    !inspection.hasExecutableTasks ||
    inspection.issues.length > 0
  ) {
    return inspection;
  }

  if (!(await confirmTrust(inspection))) return inspection;
  const trust = await adapter.setWorkspaceTrust(inspection.root, true);
  return { ...inspection, root: trust.root, trust: trust.trust };
}

export function workspaceProjectName(inspection: WorkspaceInspection | null): string | null {
  const name = inspection?.config?.project.name?.trim();
  return name || null;
}
