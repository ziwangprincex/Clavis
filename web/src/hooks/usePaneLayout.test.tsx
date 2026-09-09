import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePaneLayout, type PaneLayout } from './usePaneLayout';
import { defaultSettings, useSettingsStore } from '../store/settings';

let tree: ReactTestRenderer;
let layout: PaneLayout;
let measure: () => void;
let height = 800;
const rect = () => ({ width: 1200, height, left: 0, bottom: height });
const host = { getBoundingClientRect: rect, get clientHeight() { return height; } };
const observe = vi.fn();
const disconnect = vi.fn();
const save = vi.fn(async () => {});
let previous: ReturnType<typeof useSettingsStore.getState>;
function Harness() {
  const settings = useSettingsStore(s => s.settings);
  layout = usePaneLayout(settings);
  return <div ref={layout.mainRef}><div ref={layout.workAreaRef}><div ref={layout.editorRowRef} /></div></div>;
}
beforeEach(() => {
  vi.clearAllMocks();
  height = 800;
  previous = useSettingsStore.getState();
  useSettingsStore.setState({ loaded: true, settings: { ...defaultSettings, pane_log_height: 600 }, patchAndSave: save });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { measure = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  act(() => { tree = create(<Harness />, { createNodeMock: () => host }); });
});
afterEach(() => {
  act(() => tree.unmount());
  useSettingsStore.setState(previous);
  vi.unstubAllGlobals();
});

it('clamps on resize without overwriting the saved preferred height', () => {
  expect(observe).toHaveBeenCalledTimes(3);
  expect(layout.logHeight).toBe(600);
  act(() => { height = 400; measure(); });
  expect(layout.logHeight).toBe(220);
  expect(useSettingsStore.getState().settings.pane_log_height).toBe(600);
  expect(save).not.toHaveBeenCalled();
  act(() => { height = 800; measure(); });
  expect(layout.logHeight).toBe(600);
});

it('persists the final drag height even through an older event-handler closure', () => {
  const end = layout.endLogDrag;
  act(() => { layout.dragLog(450); });
  expect(layout.logHeight).toBe(350);
  act(() => end());
  expect(save).toHaveBeenLastCalledWith({ pane_log_height: 350 });
});

it('keeps the writing area usable while dragging on a short window', () => {
  act(() => { height = 400; measure(); });
  act(() => layout.dragLog(0));
  expect(layout.logHeight).toBe(220);
  act(() => layout.dragLog(399));
  expect(layout.logHeight).toBe(80);
  act(() => layout.dragLog(500));
  expect(layout.logHeight).toBe(80);
});
