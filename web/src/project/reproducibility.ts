import type { ArtifactStatus, BibliographyExportStatus, DocumentToolsInspection, ProjectDoctorReport, WorkspaceInspection } from '../api/tauri';

function bullet(value: string): string { return `- ${value}\n`; }

/** Explicit local report: it includes project diagnostics only, never env vars, task output, or document contents. */
export function reproducibilityReport(workspace: WorkspaceInspection, doctor: ProjectDoctorReport, tools: DocumentToolsInspection | null, artifacts: ArtifactStatus[], bibliography: BibliographyExportStatus[]): string {
  let out = `# Clavis reproducibility report\n\nGenerated locally for: \`${workspace.root}\`\n\n`;
  out += `## Project health\n\n${doctor.ok ? 'Status: ready\n' : 'Status: needs attention\n'}\n`;
  for (const check of doctor.checks) out += bullet(`[${check.status}] ${check.message}`);
  out += `\n## Declared artifacts\n\n`;
  if (artifacts.length === 0) out += 'No declared artifacts.\n';
  for (const artifact of artifacts) out += bullet(`[${artifact.status}] ${artifact.relativePath} ? ${artifact.reason}`);
  out += `\n## Bibliography exports\n\n`;
  if (bibliography.length === 0) out += 'No declared bibliography exports.\n';
  for (const item of bibliography) out += bullet(`[${item.exists ? 'present' : 'missing'}] ${item.provider}: ${item.relativePath}`);
  out += `\n## Document tools\n\n`;
  if (!tools) out += 'Tool inspection unavailable.\n';
  else {
    for (const tool of [tools.quarto, tools.pandoc]) out += bullet(`${tool.name}: ${tool.path ? `found${tool.version ? ` (${tool.version})` : ''}` : 'not found'}`);
    out += bullet(tools.quartoProjectFile ? `Quarto project: ${tools.quartoProjectFile}` : `Standalone Quarto files: ${tools.qmdFiles.length}`);
  }
  out += `\n## Scope\n\nThis report is generated locally from Clavis project diagnostics. It does not execute project tasks, read environment variables, inspect credentials, or include document contents.\n`;
  return out;
}
