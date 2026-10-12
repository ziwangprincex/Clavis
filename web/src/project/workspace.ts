import type { WorkspaceInspection } from '../api/tauri';

export function workspaceProjectName(inspection: WorkspaceInspection | null): string | null {
  const name = inspection?.config?.project.name?.trim();
  return name || null;
}
