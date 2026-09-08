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

/** Native alerts do not scroll: keep remote notes to three short lines. */
export function summarizeUpdateNotes(body = ''): string {
  const lines = body.split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !/^#{1,6}\s/.test(line));
  const bullets = lines.filter(line => /^[-*+]\s/.test(line));
  const summary = bullets.length ? bullets.slice(0, 3) : [lines.join(' ')];
  return summary.map(line => {
    const text = line.replace(/^[-*+]\s+/, '').replace(/\s+/g, ' ').trim();
    const chars = Array.from(text);
    return chars.length > 60 ? `${chars.slice(0, 59).join('')}…` : text;
  }).filter(Boolean).join('\n');
}

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
    const summary = summarizeUpdateNotes(m.body);
    const consented = await dialogConfirm(
      `Clavis ${m.version} is available.${summary ? `\n\n${summary}` : ''}\n\nInstall and relaunch now?`,
      { title: 'Update available', okLabel: 'Install & Relaunch', cancelLabel: 'Later' },
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
