// Closing a tab, from the tab strip's close button or ⌘W.

import { dialogConfirm, hasTauri, ipc } from '../api/tauri';
import { t } from '../i18n';
import { getActiveTab, useTabsStore, type Tab } from '../store/tabs';

export function tabDisplayName(tab: Tab): string {
  if (tab.filePath) {
    const parts = tab.filePath.split(/[\\/]/);
    return parts[parts.length - 1] || tab.filePath;
  }
  return t('Untitled');
}

/** Whether a tab may close: one with unsaved changes asks first. */
export async function confirmCloseTab(tab: Tab): Promise<boolean> {
  if (!tab.isDirty) return true;
  const message = t('"{name}" has unsaved changes. Close without saving?', { name: tabDisplayName(tab) });
  // Not window.confirm in the app: Tauri replaces it with one that returns a
  // Promise, which is truthy before the user has answered.
  return hasTauri() ? dialogConfirm(message) : window.confirm(message);
}

/** ⌘W: closes the active tab. With no tab left it closes the window, as Mac apps do. */
export async function closeActiveTab(): Promise<void> {
  // Like the window's keyboard shortcuts, it leaves the document alone while a dialog has the focus.
  if (typeof document !== 'undefined' && document.activeElement?.closest('[role="dialog"]')) return;
  const tab = getActiveTab();
  // Only the macOS menu gets here with no tab: the palette hides the command then.
  if (!tab) return ipc.closeWindow();
  if (await confirmCloseTab(tab)) useTabsStore.getState().closeTab(tab.id);
}
