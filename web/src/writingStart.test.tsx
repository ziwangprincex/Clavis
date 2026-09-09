import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { StartActions } from './components/StartActions';
import { Sidebar } from './components/Sidebar';
import { WriterDialog } from './components/WriterDialog';
import { useTabsStore, useSettingsStore, useProjectStore, useGitStore, useTaskStore, defaultSettings } from './store';
import { useCommandsStore } from './store/commands';
import { restoreSession } from './files/session';
import { ipc, dialogConfirm } from './api/tauri';

vi.mock('./components/EditorPane', () => ({ EditorPane: () => null }));
vi.mock('./components/PreviewPane', () => ({ PreviewPane: () => null }));
vi.mock('./components/PdfViewer', () => ({ PdfViewer: () => null }));
vi.mock('./components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('./components/TitleBar', () => ({ TitleBar: () => null }));
vi.mock('./components/StatusBar', () => ({ StatusBar: () => null }));
vi.mock('./components/SettingsDialog', () => ({ SettingsDialog: () => null }));
vi.mock('./components/ProjectDoctorDialog', () => ({ ProjectDoctorDialog: () => null }));
vi.mock('./components/SaveConflictNotice', () => ({ SaveConflictNotice: () => null }));
vi.mock('./components/WorkspaceSearchDialog', () => ({ WorkspaceSearchDialog: () => null }));
vi.mock('./components/RenameReferenceDialog', () => ({ RenameReferenceDialog: () => null }));
vi.mock('./components/TableConvertDialog', () => ({ TableConvertDialog: () => null }));
vi.mock('./components/SubmissionCheckDialog', () => ({ SubmissionCheckDialog: () => null }));
vi.mock('./components/SymbolsPanel', () => ({ SymbolsPanel: () => null }));
vi.mock('./components/RecentMenu', () => ({ RecentMenu: () => null }));
vi.mock('./components/WriterDialog', () => ({ WriterDialog: () => null }));
vi.mock('./hooks/useAppTheme', () => ({ useAppTheme: vi.fn() }));
vi.mock('./hooks/useDocumentSync', () => ({ useDocumentSync: vi.fn() }));
vi.mock('./hooks/useSessionPersistence', () => ({ useSessionPersistence: vi.fn() }));
vi.mock('./hooks/useFileDrop', () => ({ useFileDrop: vi.fn() }));
vi.mock('./hooks/useLatexAutoCompile', () => ({ useLatexAutoCompile: vi.fn() }));
vi.mock('./hooks/usePaneLayout', () => ({ usePaneLayout: () => ({}) }));
vi.mock('./update/updater', () => ({ checkForUpdates: vi.fn() }));
vi.mock('./files/session', () => ({ restoreSession: vi.fn() }));
vi.mock('./files/files', () => ({ openFileDialog: vi.fn(), pushRecentFolder: vi.fn() }));
vi.mock('./api/tauri', () => ({
  hasTauri: () => true, dialogOpen: vi.fn(), dialogSave: vi.fn(), dialogConfirm: vi.fn(),
  ipc: { inspectWorkspace: vi.fn(), inspectGitWorkspace: vi.fn(), scanWorkspaceReferences: vi.fn() },
}));
const settingsState = useSettingsStore.getState();
let tree: ReactTestRenderer;
const save = vi.fn(async (delta: Partial<typeof defaultSettings>) => useSettingsStore.getState().patch(delta));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  useSettingsStore.setState({ settings: { ...defaultSettings, ui_language: 'en' }, load: vi.fn(async () => {}), patchAndSave: save });
  useTabsStore.setState({ tabs: [], activeTabId: null });
  useProjectStore.getState().reset();
  useGitStore.getState().clear();
  useTaskStore.setState({ status: 'idle' });
  useCommandsStore.setState({ commands: new Map() });
  vi.mocked(restoreSession).mockResolvedValue(false);
  vi.mocked(ipc.inspectWorkspace).mockResolvedValue({ root: '/papers/new', config: null, issues: [], trust: 'not-required', hasExecutableTasks: false });
});
afterEach(() => {
  act(() => tree?.unmount());
  useSettingsStore.setState(settingsState);
  vi.unstubAllGlobals();
});
async function mount() { await act(async () => { tree = create(<App />); }); }
const starter = () => tree.root.findAllByType(StartActions);

it('starts with an editable empty note and direct actions, not a modal', async () => {
  await mount();
  expect(useTabsStore.getState().tabs).toHaveLength(1);
  expect(useTabsStore.getState().tabs[0]).toMatchObject({ content: '', lang: 'markdown', isDirty: false });
  expect(starter()).toHaveLength(1);
  expect(tree.root.findAllByType(WriterDialog)).toHaveLength(0);
});
it('never shows first-run actions over a restored document or restored empty buffer', async () => {
  vi.mocked(restoreSession).mockImplementation(async () => {
    useTabsStore.getState().addTab({ id: 'restored', title: 'Untitled', filePath: null, lang: 'latex', content: '', isDirty: false });
    return true;
  });
  await mount();
  expect(starter()).toHaveLength(0);
  expect(useTabsStore.getState().tabs[0].id).toBe('restored');
});
it('dismisses first-run actions on typing and does not resurrect them on undo', async () => {
  await mount();
  const id = useTabsStore.getState().activeTabId!;
  act(() => useTabsStore.getState().patchTab(id, { content: 'First paragraph', isDirty: true }));
  expect(starter()).toHaveLength(0);
  act(() => useTabsStore.getState().patchTab(id, { content: '', isDirty: false }));
  expect(starter()).toHaveLength(0);
});
it('restores the folder beside the recovered document without prompting for execution trust', async () => {
  vi.mocked(restoreSession).mockImplementationOnce(async () => {
    useProjectStore.getState().setProject({ folderPath: '/paper' });
    useTabsStore.getState().addTab({ id: 'restored', title: 'main.tex', filePath: '/paper/main.tex', lang: 'latex', content: 'Keep me', isDirty: true });
    return true;
  });
  vi.mocked(ipc.inspectWorkspace).mockResolvedValueOnce({ root: '/paper', config: null, issues: [], trust: 'untrusted', hasExecutableTasks: true });
  await mount();
  expect(ipc.inspectWorkspace).toHaveBeenCalledWith('/paper');
  expect(dialogConfirm).not.toHaveBeenCalled();
  expect(useProjectStore.getState().workspace?.trust).toBe('untrusted');
  expect(tree.root.findByType(Sidebar).props.folderTree.props.rootPath).toBe('/paper');
  expect(starter()).toHaveLength(0);
  expect(useTabsStore.getState().tabs[0].content).toBe('Keep me');
  await act(async () => { await useCommandsStore.getState().commands.get('workspace.closeFolder')!.run(); });
  expect(useProjectStore.getState().folderPath).toBeNull();
  expect(useTabsStore.getState().tabs).toHaveLength(1);
});

it('restores a folder-only session without showing the first-run overlay', async () => {
  vi.mocked(restoreSession).mockImplementationOnce(async () => {
    useProjectStore.getState().setProject({ folderPath: '/paper' });
    return false;
  });
  await mount();
  expect(tree.root.findByType(Sidebar).props.folderTree.props.rootPath).toBe('/paper');
  expect(useTabsStore.getState().tabs).toHaveLength(1);
  expect(starter()).toHaveLength(0);
});

it('does not duplicate a flat dependency list under the real folder tree', async () => {
  await mount();
  act(() => {
    useProjectStore.getState().setProject({ folderPath: '/paper', rootAbs: '/paper/main.tex', files: [{ absPath: '/paper/main.tex', relPath: 'main.tex', content: '' }] });
    useTabsStore.getState().patchTab(useTabsStore.getState().activeTabId!, { filePath: '/paper/main.tex', lang: 'latex' });
  });
  expect(tree.root.findByType(Sidebar).props.files).toBeNull();
  act(() => useProjectStore.getState().setProject({ folderPath: null }));
  expect(tree.root.findByType(Sidebar).props.files).not.toBeNull();
});

it('does not replace or duplicate an already-open unsaved draft at boot', async () => {
  useTabsStore.getState().addTab({ id: 'draft', title: 'Untitled', filePath: null, lang: 'typst', content: 'Keep me', isDirty: true });
  await mount();
  expect(restoreSession).not.toHaveBeenCalled();
  expect(useTabsStore.getState().tabs).toHaveLength(1);
  expect(useTabsStore.getState().tabs[0].content).toBe('Keep me');
});
it('routes New through the existing dialog and reuses only the untouched starter for blank notes', async () => {
  await mount();
  act(() => starter()[0].props.onNew());
  const writer = tree.root.findByType(WriterDialog);
  expect(writer.props.tool).toBe('templates');
  act(() => writer.props.onBlank());
  expect(useTabsStore.getState().tabs).toHaveLength(1);
  expect(starter()).toHaveLength(0);
  const id = useTabsStore.getState().activeTabId!;
  act(() => useTabsStore.getState().patchTab(id, { content: 'Keep this', isDirty: true }));
  act(() => tree.root.findByType(WriterDialog).props.onBlank());
  expect(useTabsStore.getState().tabs).toHaveLength(2);
  expect(useTabsStore.getState().tabs[0].content).toBe('Keep this');
});
it('keeps template state mounted while settings are open', async () => {
  await mount();
  act(() => starter()[0].props.onNew());
  const writer = tree.root.findByType(WriterDialog);
  act(() => writer.props.onSettings());
  expect(tree.root.findByType(WriterDialog)).toBe(writer);
  expect(writer.props.hidden).toBe(true);
});
it('opens a generated project folder and selects split layout without clearing other drafts', async () => {
  await mount();
  act(() => starter()[0].props.onNew());
  await act(async () => tree.root.findByType(WriterDialog).props.onCreated('/papers/new/main.typ'));
  expect(ipc.inspectWorkspace).toHaveBeenCalledWith('/papers/new');
  expect(save).toHaveBeenCalledWith({ editor_layout: 'split' });
  expect(useTabsStore.getState().tabs).toHaveLength(1);
});
it('keeps bibliography away from notes and hides empty build-output sections', async () => {
  await mount();
  act(() => starter()[0].props.onNew());
  await act(async () => tree.root.findByType(WriterDialog).props.onCreated('/papers/new/main.md'));
  const sidebar = tree.root.findByType(Sidebar);
  expect(sidebar.props.bibliography).toBeNull();
  expect(sidebar.props.references).toBeNull();
  expect(sidebar.props.artifacts).toBeNull();
  expect(save).toHaveBeenCalledWith({ editor_layout: 'editor' });
});
it('keeps advanced writer tools discoverable in the command palette', async () => {
  await mount();
  const commands = useCommandsStore.getState().commands;
  expect(commands.get('file.new')?.shortcut).toBeTruthy();
  for (const id of ['writer.templates', 'writer.history', 'writer.environment', 'file.blank']) expect(commands.has(id)).toBe(true);
  await act(async () => { await commands.get('writer.environment')!.run(); });
  expect(tree.root.findByType(WriterDialog).props.tool).toBe('environment');
});
it('does not flash start actions while session recovery is still pending', async () => {
  let resolve!: (value: boolean) => void;
  vi.mocked(restoreSession).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount();
  expect(starter()).toHaveLength(0);
  await act(async () => resolve(false));
  expect(starter()).toHaveLength(1);
});

it('keeps empty-note sidebar minimal but exposes research folder action', async () => {
  await mount();
  const sidebar = tree.root.findByType(Sidebar);
  expect(sidebar.props.writing).toBeNull();
  expect(sidebar.props.onOpenFolder).toBeTypeOf('function');
  const id = useTabsStore.getState().activeTabId!;
  act(() => useTabsStore.getState().patchTab(id, { content: 'A draft' }));
  expect(sidebar.props.writing).not.toBeNull();
  act(() => useTabsStore.getState().patchTab(id, { content: '  ' }));
  expect(sidebar.props.writing).toBeNull();
});
