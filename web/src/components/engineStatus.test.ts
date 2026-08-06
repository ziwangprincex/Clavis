import { describe, expect, it } from 'vitest';
import type { EngineInfo } from '../api/tauri';
import {
  BIB_ENGINES,
  LATEX_ENGINES,
  describeEngineStatus,
  engineLabel,
  findEngine,
  isUnknownEngine,
} from './engineStatus';

const found: EngineInfo = {
  name: 'pdflatex',
  path: 'C:\\texlive\\2025\\bin\\pdflatex.exe',
  version: 'pdfTeX 3.141592653-2.6-1.40.26',
};
const absent: EngineInfo = { name: 'xelatex', path: null, version: null };

describe('engine detection labels', () => {
  it('shows a bare name until the probe has answered', () => {
    // null = not probed yet. Annotating "not found" here would be a false claim.
    expect(engineLabel('pdflatex', null)).toBe('pdflatex');
  });

  it('marks only engines the probe could not resolve', () => {
    const list = [found, absent];
    expect(engineLabel('pdflatex', list)).toBe('pdflatex');
    expect(engineLabel('xelatex', list)).toBe('xelatex — not found');
  });

  it('does not claim "not found" when detection itself failed', () => {
    // A rejected IPC tells us nothing about the user's TeX install. Reporting
    // "not found" here would blame their setup for our failed call.
    expect(engineLabel('pdflatex', 'failed')).toBe('pdflatex');
  });

  it('treats an engine absent from a successful probe as not found', () => {
    // The backend returns every name it probed, so a name missing from a
    // resolved list really was not resolvable.
    expect(engineLabel('lualatex', [])).toBe('lualatex — not found');
  });

  it('keeps every engine selectable regardless of detection', () => {
    // Detection annotates, never filters: a user must be able to select an
    // engine they are about to install.
    expect(LATEX_ENGINES).toEqual(['pdflatex', 'xelatex', 'lualatex']);
    expect(BIB_ENGINES).toEqual(['bibtex', 'biber']);
  });

  it('finds an engine by name and reports undefined otherwise', () => {
    expect(findEngine([found], 'pdflatex')).toBe(found);
    expect(findEngine([found], 'biber')).toBeUndefined();
    expect(findEngine(null, 'pdflatex')).toBeUndefined();
    expect(findEngine('failed', 'pdflatex')).toBeUndefined();
  });
});

describe('off-list engines from a hand-edited settings.json', () => {
  it('flags a stored engine the dropdown does not offer', () => {
    // latex_engine is typed as a bare string, so this is reachable. Without a
    // synthetic option React shows the first entry as selected and Save
    // silently rewrites the user's choice.
    expect(isUnknownEngine('pdflatex-dev', LATEX_ENGINES)).toBe(true);
    expect(isUnknownEngine('pdflatex', LATEX_ENGINES)).toBe(false);
  });

  it('does not flag an empty or blank value', () => {
    // Nothing stored yet is not a user choice worth surfacing.
    expect(isUnknownEngine('', LATEX_ENGINES)).toBe(false);
    expect(isUnknownEngine('   ', LATEX_ENGINES)).toBe(false);
  });

  it('accepts auto and none as valid bibliography choices', () => {
    const choices = ['auto', 'none', ...BIB_ENGINES];
    expect(isUnknownEngine('auto', choices)).toBe(false);
    expect(isUnknownEngine('none', choices)).toBe(false);
    expect(isUnknownEngine('biber', choices)).toBe(false);
    expect(isUnknownEngine('bibtex8', choices)).toBe(true);
  });
});

describe('engine status view', () => {
  it('reports pending while the first probe is in flight', () => {
    // The distinction that matters: in-flight must not render as missing.
    expect(describeEngineStatus(null, 'pdflatex', true)).toEqual({ kind: 'pending' });
  });

  it('stays hidden before any probe has been requested', () => {
    expect(describeEngineStatus(null, 'pdflatex', false)).toEqual({ kind: 'hidden' });
  });

  it('reports failure distinctly from absence', () => {
    // Both are "no path to show", but only one licenses "not installed".
    expect(describeEngineStatus('failed', 'pdflatex', false)).toEqual({ kind: 'failed' });
    expect(describeEngineStatus([absent], 'xelatex', false)).toEqual({ kind: 'missing' });
  });

  it('keeps reporting failure even while a retry is running', () => {
    expect(describeEngineStatus('failed', 'pdflatex', true)).toEqual({ kind: 'failed' });
  });

  it('reports missing for an engine absent from a resolved probe', () => {
    expect(describeEngineStatus([found], 'lualatex', false)).toEqual({ kind: 'missing' });
  });

  it('reports a resolved path with its version banner', () => {
    expect(describeEngineStatus([found], 'pdflatex', false)).toEqual({
      kind: 'found',
      path: found.path,
      version: found.version,
    });
  });

  it('still reports a path when the version probe was killed', () => {
    // A 3s timeout kills `--version` and yields null, but the engine is on disk
    // and usable — calling it missing would be wrong.
    const noVersion: EngineInfo = { name: 'pdflatex', path: found.path, version: null };
    expect(describeEngineStatus([noVersion], 'pdflatex', false)).toEqual({
      kind: 'found',
      path: found.path,
      version: null,
    });
  });

  it('keeps showing the previous result while a re-probe runs', () => {
    // "Detect again" sets probing=true with a resolved list still in state;
    // flipping back to pending would make the pane flicker on every refresh.
    expect(describeEngineStatus([found], 'pdflatex', true)).toEqual({
      kind: 'found',
      path: found.path,
      version: found.version,
    });
  });
});
