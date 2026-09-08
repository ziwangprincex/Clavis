import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TypstReader } from './TypstReader';
import type { TypstPage } from '../api/tauri';

const zoom = vi.hoisted(() => ({
  bind: vi.fn(() => vi.fn()),
  capture: vi.fn(() => ({ index: 0 })),
  restore: vi.fn(),
}));
vi.mock('../pdf/zoom', () => ({
  bindPreviewZoom: zoom.bind,
  capturePageAnchor: zoom.capture,
  restorePageAnchor: zoom.restore,
}));
let tree: ReactTestRenderer;
afterEach(() => {
  act(() => tree?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('keeps SVG and text nodes mounted and restores the reading anchor while scaling from fit width', () => {
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const host = Object.assign(new EventTarget(), { querySelectorAll: () => [] });
  const scroll = { current: host as unknown as HTMLDivElement };
  const page: TypstPage = {
    svg: '<svg>paper</svg>',
    svgHash: 'paper',
    width: 600,
    height: 800,
    points: [],
    text: [{ text: 'reading', size: 12, width: 50, matrix: [1, 0, 0, 1, 0, 12] }],
    links: [],
  };
  act(() => {
    tree = create(<TypstReader pages={[page]} scroll={scroll} stale={false} />);
  });
  const art = tree.root.findAllByType('div').find((div) => div.props.dangerouslySetInnerHTML)!;
  const text = tree.root.findByType('text');
  const select = tree.root.findByProps({ 'aria-label': 'Zoom' });
  act(() => select.props.onChange({ target: { value: '125' } }));
  expect(tree.root.findAllByType('div').find((div) => div.props.dangerouslySetInnerHTML)).toBe(art);
  expect(tree.root.findByType('text')).toBe(text);
  expect(
    tree.root
      .findAllByType('div')
      .some((div) => div.props.style?.width === 'calc(min(100%, 960px) * 1.25)'),
  ).toBe(true);
  expect(zoom.capture).toHaveBeenCalled();
  expect(zoom.restore).toHaveBeenCalledWith(host, [], { index: 0 });
  expect(zoom.bind).toHaveBeenCalledTimes(1);
});


it('keeps search selection and scroll across recompiles, clamping only when a result disappears', () => {
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const host = Object.assign(new EventTarget(), {
    querySelectorAll: () => [], scrollTop: 0,
    querySelector: (selector: string) => ({ offsetTop: selector.includes('"1"') ? 1000 : 0, clientHeight: 800 }),
  });
  const scroll = { current: host as unknown as HTMLDivElement };
  const pages: TypstPage[] = [0, 1].map(i => ({
    svg: '<svg/>', svgHash: String(i), width: 600, height: 800, points: [], links: [],
    text: [{ text: 'needle', size: 12, width: 50, matrix: [1,0,0,1,0,100] }],
  }));
  act(() => { tree = create(<TypstReader pages={pages} scroll={scroll} stale={false} />); });
  const search = () => tree.root.findByProps({ 'aria-label': 'Find in document' });
  act(() => search().props.onChange({ target: { value: 'needle' } }));
  act(() => tree.root.findByProps({ 'aria-label': 'Next match' }).props.onClick());
  const position = host.scrollTop;
  expect(position).toBeGreaterThan(900);
  act(() => tree.update(<TypstReader pages={pages.map(p => ({...p}))} scroll={scroll} stale={false} />));
  expect(host.scrollTop).toBe(position);
  expect(tree.root.findByProps({ 'aria-live': 'polite' }).props.children).toBe('2/2');
  act(() => tree.update(<TypstReader pages={pages.slice(0, 1)} scroll={scroll} stale={false} />));
  expect(host.scrollTop).toBe(position);
  expect(tree.root.findByProps({ 'aria-live': 'polite' }).props.children).toBe('1/1');
  act(() => search().props.onChange({ target: { value: 'need' } }));
  expect(host.scrollTop).toBeLessThan(100);
});
