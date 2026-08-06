import type { EngineInfo } from '../api/tauri';

/// Selectable engines. Kept as constant lists rather than derived from the
/// probe: an engine the user has yet to install must still be selectable, so
/// detection annotates these options instead of filtering them.
export const LATEX_ENGINES = ['pdflatex', 'xelatex', 'lualatex'] as const;
export const BIB_ENGINES = ['bibtex', 'biber'] as const;

/// Outcome of a detection round.
///
/// `null` (not probed yet) and `'failed'` (the IPC call rejected) are kept
/// separate from a real `EngineInfo[]`, because neither of them licenses the
/// claim "this engine is not installed" — only a probe that actually ran and
/// came back without a path does.
export type ProbeResult = EngineInfo[] | 'failed' | null;

function probeList(result: ProbeResult): EngineInfo[] | null {
  return Array.isArray(result) ? result : null;
}

export function findEngine(result: ProbeResult, name: string): EngineInfo | undefined {
  return probeList(result)?.find(info => info.name === name);
}

/// Annotate a select option with detection state. Only a probe that resolved
/// may add `— not found`: while it is still running, or after it failed, the
/// bare name is shown rather than a claim we cannot support.
export function engineLabel(name: string, result: ProbeResult): string {
  const list = probeList(result);
  if (!list) return name;
  return findEngine(list, name)?.path ? name : `${name} — not found`;
}

/// True when `name` is not one of the engines this pane offers — i.e. it came
/// from a hand-edited `settings.json`. `latex_engine` is typed as a bare
/// `string`, so an unknown value must be surfaced instead of silently
/// disappearing from the dropdown (which would show the first option as
/// selected and rewrite the setting on save).
export function isUnknownEngine(name: string, offered: readonly string[]): boolean {
  return name.trim() !== '' && !offered.includes(name);
}

/// What the status line under an engine dropdown should say.
///
/// The states are deliberately distinct. `pending` (probe in flight) and
/// `failed` (probe errored) must not render as `missing`: reporting "not
/// installed" without evidence is a false claim, and that exact conflation is
/// the asset-preview bug this repo already fixed once ("treated every null
/// preview as perpetually loading"). `found` is kept separate from its version
/// string because a resolved engine whose `--version` was killed on the
/// timeout still exists.
export type EngineStatusView =
  | { kind: 'hidden' }
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'missing' }
  | { kind: 'found'; path: string; version: string | null };

export function describeEngineStatus(
  result: ProbeResult,
  name: string,
  probing: boolean,
): EngineStatusView {
  if (result === 'failed') return { kind: 'failed' };
  if (result === null) return probing ? { kind: 'pending' } : { kind: 'hidden' };
  const info = findEngine(result, name);
  if (!info?.path) return { kind: 'missing' };
  return { kind: 'found', path: info.path, version: info.version };
}
