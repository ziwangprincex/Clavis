// Document actions run from commands and the toolbar. They read the stores
// directly, so they hold no component state and report through the status bar.

import { resolveLocale, t } from '../i18n';
import { dialogSave, ipc } from '../api/tauri';
import { inside, typstInput } from '../compile/project';
import { belongsToPdf } from '../compile/target';
import { getActiveTab, usePdfStore, useProjectStore, useSettingsStore, useStatusStore, useTabsStore, type StatusKind } from '../store';

function setStatus(text: string, kind: StatusKind) {
  useStatusStore.getState().set(text, kind);
}

export async function exportLatexPdf() {
  const tab = getActiveTab();
  const pdf = usePdfStore.getState();
  if (!tab || !pdf.bytes || !pdf.workdirToken || !belongsToPdf(tab, pdf)) {
    setStatus('No compiled PDF yet', 'error');
    return;
  }
  try {
    const target = await dialogSave({
      defaultPath: pdf.sourceRoot ? pdf.sourceRoot.replace(/\.tex$/i, '.pdf') : undefined,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (typeof target === 'string') {
      const latest = usePdfStore.getState();
      if (latest.workdirToken !== pdf.workdirToken || latest.bytes !== pdf.bytes) {
        setStatus('The preview changed during export. Export again after compilation finishes.', 'error');
        return;
      }
      await ipc.exportLatexPdf(pdf.workdirToken!, target);
      setStatus('PDF exported', 'ok');
    }
  } catch (e) {
    console.error('export PDF failed', e);
    setStatus('Export failed', 'error');
  }
}

/** Markdown has no typeset output; it exports as one self-contained HTML file. */
export function exportHtml() {
  const tab = getActiveTab();
  if (tab?.lang !== 'markdown') return;
  const language = resolveLocale(useSettingsStore.getState().settings.ui_language);
  void import('./exportMarkdown').then(module => module.exportMarkdownHtml(tab, language));
}

/** Markdown to a Word document. */
export function exportMarkdownDocx() {
  const tab = getActiveTab();
  if (tab?.lang !== 'markdown') return;
  void import('./exportMarkdown').then(module => module.exportMarkdownDocx(tab));
}

/** Markdown to PDF through the print dialog's "Save as PDF". */
export function exportMarkdownPdf() {
  const tab = getActiveTab();
  if (tab?.lang !== 'markdown') return;
  void import('./exportMarkdown').then(module => module.exportMarkdownPdf(tab));
}

export async function exportTypstPdf() {
  const tab = getActiveTab();
  if (!tab || tab.lang !== 'typst') return;
  try {
    setStatus('Compiling PDF…', 'info');
    const input = await typstInput(tab);
    let pdf: Uint8Array;
    try {
      pdf = await ipc.compileTypstPdf(input.source, input.docPath, input.snapshot);
    } catch (error) {
      const message = String(error).split('\n')[0];
      setStatus(message ? `Compile failed: ${message}` : t("Compile failed"), 'error');
      return;
    }
    const target = await dialogSave({
      defaultPath: input.docPath ? input.docPath.replace(/\.typ$/i, '.pdf') : undefined,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (typeof target === 'string') {
      await ipc.saveBinaryFile(target, pdf);
      setStatus('PDF exported', 'ok');
    } else {
      setStatus('Ready', 'info');
    }
  } catch (e) {
    console.error('export Typst PDF failed', e);
    setStatus('Export failed', 'error');
  }
}

export async function setProjectMain() {
  const tab = getActiveTab();
  if (!tab?.filePath) return;
  try {
    const r = tab.lang === 'latex' ? await ipc.collectProjectFiles(tab.filePath) : { files: [], warnings: [] };
    const directory = tab.filePath.replace(/[\\/][^\\/]*$/, '');
    for (const other of useTabsStore.getState().tabs) {
      if (other.lang === tab.lang && inside(other.filePath, directory)) useTabsStore.getState().patchTab(other.id, { projectRoot: tab.filePath });
    }
    useProjectStore.setState({
      rootAbs: tab.filePath,
      rootBasename: tab.filePath.split(/[\\/]/).pop() ?? null,
      activeAbs: tab.filePath,
      files: r.files ?? [],
      warnings: r.warnings ?? [],
    });
    setStatus('Project main set', 'ok');
  } catch (e) {
    console.error('set main failed', e);
    setStatus('Set main failed', 'error');
  }
}
