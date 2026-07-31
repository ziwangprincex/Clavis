import { describe, it, expect } from 'vitest';
import { migrateSettings, defaultSettings, type Settings } from './settings';

function withLegacy(px: number, ratio = 0): Settings {
  return {
    ...defaultSettings,
    pane_editor_ratio: ratio,
    // The legacy key is not on the Settings type anymore; it still arrives from
    // disk because it's a typed field on the Rust struct.
    ...({ pane_editor_width: px } as unknown as Partial<Settings>),
  } as Settings;
}

describe('migrateSettings: pane_editor_width -> pane_editor_ratio', () => {
  it('converts a legacy pixel width to a ratio', () => {
    const s = migrateSettings(withLegacy(600));
    expect(s.pane_editor_ratio).toBeCloseTo(0.5, 5);
  });

  it('clamps absurd legacy values into a usable range', () => {
    expect(migrateSettings(withLegacy(20_000)).pane_editor_ratio).toBe(0.85);
    // 130px is above the >120 guard but converts to ~0.108, below the floor.
    expect(migrateSettings(withLegacy(130)).pane_editor_ratio).toBe(0.15);
  });

  it('ignores the legacy key when a ratio is already set', () => {
    expect(migrateSettings(withLegacy(600, 0.3)).pane_editor_ratio).toBe(0.3);
  });

  it('leaves settings alone when there is no legacy value', () => {
    expect(migrateSettings({ ...defaultSettings }).pane_editor_ratio).toBe(0);
  });

  it('ignores a legacy value at or below the 120px guard', () => {
    expect(migrateSettings(withLegacy(120)).pane_editor_ratio).toBe(0);
    expect(migrateSettings(withLegacy(0)).pane_editor_ratio).toBe(0);
  });
});
