import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/tauri';
import { checkForUpdates, summarizeUpdateNotes } from './updater';
import notes from '../../../docs/releases/v1.3.2.md?raw';

vi.mock('../api/tauri', () => ({
  hasTauri: vi.fn(), checkUpdate: vi.fn(), installUpdate: vi.fn(),
  relaunch: vi.fn(), getAppVersion: vi.fn(), dialogConfirm: vi.fn(), dialogMessage: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.hasTauri).mockReturnValue(true);
  vi.mocked(api.checkUpdate).mockResolvedValue({ shouldUpdate: true, manifest: { version: '1.3.1', body: notes } });
  vi.mocked(api.dialogConfirm).mockResolvedValue(false);
  vi.mocked(api.installUpdate).mockResolvedValue(undefined);
  vi.mocked(api.relaunch).mockResolvedValue(undefined);
  vi.mocked(api.dialogMessage).mockResolvedValue(undefined);
  vi.mocked(api.getAppVersion).mockResolvedValue('1.3.1');
});

afterEach(() => vi.restoreAllMocks());

describe('compact update notes', () => {
  it('keeps three short highlights without headings or introductory paragraphs', () => {
    expect(summarizeUpdateNotes('# Clavis 1.3.1\n\nIntroduction\n## Changes\n- Saving\n- Preview\n- Completion\n- Fourth change'))
      .toBe('Saving\nPreview\nCompletion');
  });

  it('caps long individual bullets even when there are hundreds of them', () => {
    const body = Array.from({ length: 500 }, () => `- ${'change '.repeat(100)}`).join('\n');
    const summary = summarizeUpdateNotes(body);
    expect(summary.split('\n')).toHaveLength(3);
    expect(summary.length).toBeLessThanOrEqual(182);
    expect(summary.split('\n').every(line => line.endsWith('…'))).toBe(true);
  });

  it('collapses unstructured paragraphs into a single bounded line', () => {
    const summary = summarizeUpdateNotes('Plain text\r\n'.repeat(1000));
    expect(summary.split('\n')).toHaveLength(1);
    expect(summary.length).toBeLessThanOrEqual(60);
  });

  it('bounds Chinese notes without splitting Unicode code points', () => {
    const summary = summarizeUpdateNotes(`- ${'𠮷'.repeat(100)}`);
    expect(Array.from(summary)).toHaveLength(60);
    expect(summary).toBe(`${'𠮷'.repeat(59)}…`);
  });

  it('handles empty notes and heading-only notes', () => {
    for (const body of [undefined, '', ' \n\t', '# Clavis 1.3.1\n## Changes']) {
      expect(summarizeUpdateNotes(body)).toBe('');
    }
  });

  it('keeps the current release notes safe for old clients without client-side truncation', () => {
    expect(notes.length).toBeLessThanOrEqual(240);
    expect(notes.split('\n').filter(line => line.startsWith('- '))).toHaveLength(3);
    expect(summarizeUpdateNotes(notes)).not.toContain('…');
  });
});

describe('update confirmation', () => {
  it('bounds the actual native dialog body and uses explicit action labels', async () => {
    vi.mocked(api.checkUpdate).mockResolvedValue({
      shouldUpdate: true, manifest: { version: '1.3.1', body: `# Release\n${'- Long release text '.repeat(1000)}` },
    });
    await checkForUpdates({ silent: false });
    const [message, options] = vi.mocked(api.dialogConfirm).mock.calls[0];
    expect(message.length).toBeLessThan(300);
    expect(message).toContain('Clavis 1.3.1');
    expect(message).toContain('Install and relaunch now?');
    expect(options).toEqual({ title: 'Update available', okLabel: 'Install & Relaunch', cancelLabel: 'Later' });
    expect(api.installUpdate).not.toHaveBeenCalled();
    expect(api.relaunch).not.toHaveBeenCalled();
  });

  it('installs only after consent and relaunches only after installation completes', async () => {
    vi.mocked(api.dialogConfirm).mockResolvedValue(true);
    vi.mocked(api.installUpdate).mockImplementation(async () => {
      expect(api.relaunch).not.toHaveBeenCalled();
    });
    await checkForUpdates({ silent: false });
    expect(api.installUpdate).toHaveBeenCalledOnce();
    expect(api.relaunch).toHaveBeenCalledOnce();
  });

  it('does not relaunch after a failed install and releases the check lock', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(api.dialogConfirm).mockResolvedValueOnce(true);
    vi.mocked(api.installUpdate).mockRejectedValueOnce(new Error('signature mismatch'));
    await checkForUpdates({ silent: false });
    expect(api.relaunch).not.toHaveBeenCalled();
    expect(api.dialogMessage).toHaveBeenCalledWith(expect.stringContaining('signature mismatch'), expect.anything());
    await checkForUpdates({ silent: false });
    expect(api.checkUpdate).toHaveBeenCalledTimes(2);
  });

  it('still offers updates without notes', async () => {
    vi.mocked(api.checkUpdate).mockResolvedValue({ shouldUpdate: true, manifest: { version: '1.3.1' } });
    await checkForUpdates({ silent: true });
    expect(api.dialogConfirm).toHaveBeenCalledWith('Clavis 1.3.1 is available.\n\nInstall and relaunch now?', expect.anything());
  });

  it('keeps up-to-date startup checks quiet and manual checks informative', async () => {
    vi.mocked(api.checkUpdate).mockResolvedValue({ shouldUpdate: false });
    await checkForUpdates({ silent: true });
    expect(api.dialogMessage).not.toHaveBeenCalled();
    await checkForUpdates({ silent: false });
    expect(api.dialogMessage).toHaveBeenCalledWith('You’re up to date (v1.3.1).', expect.anything());
    expect(api.dialogConfirm).not.toHaveBeenCalled();
  });

  it('prevents a second prompt while the first one awaits consent', async () => {
    let decide!: (value: boolean) => void;
    vi.mocked(api.dialogConfirm).mockReturnValueOnce(new Promise(resolve => { decide = resolve; }));
    const first = checkForUpdates({ silent: true });
    await vi.waitFor(() => expect(api.dialogConfirm).toHaveBeenCalledOnce());
    await checkForUpdates({ silent: false });
    expect(api.checkUpdate).toHaveBeenCalledOnce();
    decide(false);
    await first;
  });
});
