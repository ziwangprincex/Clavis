import { fs, hasTauri, type DiskSnapshot } from '../api/tauri';
import { useTabsStore, newTabId, type Tab } from '../store/tabs';

let pending: Promise<void> = Promise.resolve();
/** All document mutations, including probes that update a tab, share one queue. */
export function documentOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.then(operation);
  pending = next.then(() => {}, () => {});
  return next;
}

export function markConflict(id: string, targetPath: string, disk: DiskSnapshot): void {
  const state = useTabsStore.getState();
  const tab = state.tabs.find(t => t.id === id);
  if (!tab) return;
  state.patchTab(id, { conflict: { targetPath, disk }, isDirty: true, diskError: undefined });
}

/** Only called inside documentOperation. A read can finish after a new edit. */
export async function reconcileTab(id: string): Promise<void> {
  const getTab = () => useTabsStore.getState().tabs.find(t => t.id === id);
  const before = getTab();
  if (!before?.filePath) return;
  try {
    const disk = await fs.readDocument(before.filePath);
    const current = getTab();
    if (!current || current.filePath !== before.filePath) return;
    const state = useTabsStore.getState();
    if (disk.content === current.content) {
      state.patchTab(id, { diskRevision: disk.revision, diskStamp: disk.stamp, isDirty: false, diskError: undefined,
        conflict: current.conflict?.targetPath === current.filePath ? undefined : current.conflict });
    } else if (disk.revision === current.diskRevision) {
      state.patchTab(id, { diskStamp: disk.stamp, diskError: undefined,
        conflict: current.conflict?.targetPath === current.filePath ? undefined : current.conflict });
    } else if (!current.isDirty && current.diskRevision && disk.content !== null) {
      state.patchTab(id, { content: disk.content, diskRevision: disk.revision, diskStamp: disk.stamp,
        isDirty: false, conflict: undefined, diskError: undefined });
    } else {
      // Missing file, unknown legacy baseline, or both sides edited. Never guess.
      markConflict(id, current.filePath, disk);
      state.patchTab(id, { diskStamp: disk.stamp });
    }
  } catch (error) {
    const current = getTab();
    if (current?.filePath === before.filePath) {
      useTabsStore.getState().patchTab(id, { diskError: String(error) });
    }
  }
}

let checking = false;
/** Poll metadata only. Read contents on change; focus/retry forces verification. */
export async function checkExternalDocuments(force = false): Promise<void> {
  if (!hasTauri() || checking) return;
  checking = true;
  try {
    await documentOperation(async () => {
      const tabs = useTabsStore.getState().tabs.filter(t => t.filePath);
      for (let offset = 0; offset < tabs.length; offset += 200) {
        const batch = tabs.slice(offset, offset + 200);
        const probes = await fs.probeDocuments(batch.map(t => t.filePath!));
        for (const probe of probes) {
          const tab = useTabsStore.getState().tabs.find(t => t.filePath === probe.path);
          if (!tab) continue;
          if (probe.error) {
            if (tab.diskError !== probe.error) useTabsStore.getState().patchTab(tab.id, { diskError: probe.error });
          } else if (force || probe.stamp !== tab.diskStamp || !tab.diskRevision || tab.diskError) {
            await reconcileTab(tab.id);
          }
        }
      }
    });
  } finally { checking = false; }
}

/** A discard operation retains a scratch recovery document without moving focus. */
export function retainLocalCopy(tab: Pick<Tab, 'title' | 'lang' | 'content'>, label = 'local copy'): void {
  const state = useTabsStore.getState();
  const title = `${tab.title} (${label})`;
  if (state.tabs.some(t => !t.filePath && t.title === title && t.content === tab.content)) return;
  state.setTabs([...state.tabs, {
    id: newTabId(), title, filePath: null,
    lang: tab.lang, content: tab.content, isDirty: true,
  }]);
}
