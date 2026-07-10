// Auto-update flow — thin orchestration over the Tauri updater.
//
// checkForUpdates() asks the updater if a newer signed GitHub release exists.
// If so it shows a native confirm dialog (version + release notes); on accept it
// downloads/verifies/installs the update and relaunches into the new version.
//
// `silent` mode (used by the startup auto-check) shows nothing when the app is
// already up to date or when the check fails — so a transient network hiccup or
// browser-preview mode never nags the user. Explicit "Check for Updates…" from
// the command palette passes silent:false so the user always gets feedback.

import {
  hasTauri,
  checkUpdate,
  installUpdate,
  relaunch,
  getAppVersion,
  dialogConfirm,
  dialogMessage,
} from '../api/tauri';

let inFlight = false;

export async function checkForUpdates({ silent }: { silent: boolean }): Promise<void> {
  if (!hasTauri()) {
    if (!silent) {
      await dialogMessage('Updates are only available in the desktop app.', {
        title: 'Check for Updates',
      });
    }
    return;
  }
  // Guard against overlapping checks (startup auto-check + a manual click).
  if (inFlight) return;
  inFlight = true;
  try {
    const status = await checkUpdate();
    if (!status.shouldUpdate || !status.manifest) {
      if (!silent) {
        const version = await getAppVersion().catch(() => '');
        await dialogMessage(
          version ? `You’re up to date (v${version}).` : 'You’re up to date.',
          { title: 'Check for Updates' },
        );
      }
      return;
    }

    const m = status.manifest;
    const notes = m.body ? `\n\n${m.body}` : '';
    const consented = await dialogConfirm(
      `Clavis ${m.version} is available. Install and relaunch now?${notes}`,
      { title: 'Update available' },
    );
    if (!consented) return;

    await installUpdate();
    await relaunch();
  } catch (e) {
    console.error('update check failed', e);
    if (!silent) {
      await dialogMessage(`Update check failed: ${String(e)}`, {
        title: 'Check for Updates',
      });
    }
  } finally {
    inFlight = false;
  }
}
