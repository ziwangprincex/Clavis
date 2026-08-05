import { dialogConfirm, ipc, type DocumentArtifact, type DocumentToolsInspection } from '../api/tauri';
import { useProjectStore, useTaskStore, type Tab } from '../store';

export type DocumentTool = 'quarto' | 'pandoc';
export type DocumentFormat = 'html' | 'pdf' | 'docx';

export interface RenderContext {
  root: string;
  document: string;
  tool: DocumentTool;
  format: DocumentFormat;
}

export function isRenderableDocument(tab: Tab | undefined): boolean {
  return !!tab?.filePath && /\.(?:qmd|md)$/i.test(tab.filePath);
}

export async function ensureRenderTrust(root: string): Promise<boolean> {
  const workspace = useProjectStore.getState().workspace;
  if (workspace?.root === root && workspace.trust === 'trusted') return true;
  const accepted = await dialogConfirm(
    'Rendering runs an installed external tool inside this workspace. Trust this workspace for Quarto/Pandoc execution?',
    { title: 'Trust workspace for rendering?' },
  );
  if (!accepted) return false;
  const trust = await ipc.setWorkspaceTrust(root, true);
  if (workspace?.root === root) {
    useProjectStore.getState().setProject({ workspace: { ...workspace, trust: trust.trust } });
  }
  return true;
}

export async function inspectRenderTools(root: string): Promise<DocumentToolsInspection> {
  return ipc.inspectDocumentTools(root);
}

export async function startRender(
  context: RenderContext,
  tab: Tab,
): Promise<void> {
  if (tab.isDirty) throw new Error('Save the Document before rendering so Quarto/Pandoc sees the latest content.');
  if (!(await ensureRenderTrust(context.root))) throw new Error('Workspace trust was not granted.');
  const tools = await inspectRenderTools(context.root);
  const selected = context.tool === 'quarto' ? tools.quarto : tools.pandoc;
  if (!selected.path) throw new Error(`${context.tool} was not found. Install it or add it to PATH.`);
  await useTaskStore.getState().startRender(context);
}

export async function newestArtifact(context: RenderContext): Promise<DocumentArtifact | null> {
  const artifacts = await ipc.listDocumentArtifacts({
    root: context.root,
    document: context.document,
    format: context.format,
  });
  return artifacts[0] ?? null;
}
