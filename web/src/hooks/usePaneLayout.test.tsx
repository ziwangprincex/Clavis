import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePaneLayout, type PaneLayout } from './usePaneLayout';
import { defaultSettings, useSettingsStore } from '../store/settings';

let tree: ReactTestRenderer;
let layout: PaneLayout;
let measure: () => void;
let width = 1200;
const host = { getBoundingClientRect: () => ({ width, height: 800, left: 0 }) };
const observe = vi.fn();
const disconnect = vi.fn();
const save = vi.fn(async () => {});
let previous: ReturnType<typeof useSettingsStore.getState>;
function Harness() {
  const settings = useSettingsStore(s => s.settings);
  layout = usePaneLayout(settings);
  return <div ref={layout.mainRef}><div ref={layout.editorRowRef} /></div>;
}
beforeEach(() => {
  vi.clearAllMocks();
  width = 1200;
  previous = useSettingsStore.getState();
  useSettingsStore.setState({ loaded: true, settings: { ...defaultSettings, editor_layout: 'split', pane_sidebar_width: 600 }, patchAndSave: save });
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

it('clamps on resize without overwriting the saved preferred width', () => {
  expect(observe).toHaveBeenCalledTimes(2);
  expect(layout.sidebarWidth).toBe(600);
  act(() => { width = 720; measure(); });
  expect(layout.sidebarWidth).toBe(278);
  expect(useSettingsStore.getState().settings.pane_sidebar_width).toBe(600);
  expect(save).not.toHaveBeenCalled();
  act(() => { width = 1200; measure(); });
  expect(layout.sidebarWidth).toBe(600);
});

it('persists the final drag width even through an older event-handler closure', () => {
  const end = layout.endSidebarDrag;
  act(() => { layout.dragSidebar(450); });
  expect(layout.sidebarWidth).toBe(450);
  act(() => end());
  expect(save).toHaveBeenLastCalledWith({ pane_sidebar_width: 450 });
});
