import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';
import { ColorField } from './ColorField';
import colorCss from './ColorField.module.css?raw';
import pdfCss from './PdfViewer.module.css?raw';

it('uses the effective color and delegates edits without hiding the native keyboard control', () => {
  const onChange = vi.fn();
  const onReset = vi.fn();
  const tree = create(<ColorField label="Accent color" value="#c3adc9" overridden onChange={onChange} onReset={onReset} />);
  const input = tree.root.findByType('input');
  expect(input.props.type).toBe('color');
  expect(input.props.value).toBe('#c3adc9');
  expect(input.props['aria-label']).toBe('Accent color');
  expect(JSON.stringify(tree.toJSON())).toContain('#C3ADC9');
  act(() => input.props.onChange({ target: { value: '#496c79' } }));
  expect(onChange).toHaveBeenCalledWith('#496c79');
  act(() => tree.root.findByType('button').props.onClick());
  expect(onReset).toHaveBeenCalledOnce();
  tree.unmount();
});

it('does not present an active reset action for an inherited theme color', () => {
  const tree = create(<ColorField label="Accent color" value="#52694f" overridden={false} onChange={() => {}} onReset={() => {}} />);
  expect(tree.root.findByType('button').props.disabled).toBe(true);
  tree.unmount();
});

function rules(css: string) {
  const values = new Map<string, Record<string, string>>();
  postcss.parse(css).walkRules(rule => {
    values.set(rule.selector, Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value])));
  });
  return values;
}

describe('color stylesheet contracts, not native visual acceptance', () => {
  it('removes native 3D color-input chrome while preserving focus visibility', () => {
    const style = rules(colorCss);
    expect(style.get('.swatch')).toMatchObject({ appearance: 'none', '-webkit-appearance': 'none', border: '0', padding: '0', 'box-shadow': 'none' });
    expect(style.get('.swatch::-webkit-color-swatch-wrapper')?.padding).toBe('0');
    expect(style.has('.swatch::-webkit-color-swatch')).toBe(true);
    expect(style.has('.swatch::-moz-color-swatch')).toBe(true);
    expect(style.get('.reset')?.background).toBe('transparent');
    expect(colorCss).not.toMatch(/outline:\s*(?:none|0)/);
  });
  it('uses fixed neutral PDF surroundings for each brightness mode, never an accent token', () => {
    const style = rules(pdfCss);
    expect(style.get('.root')?.['--pdf-desk']).toBe('#242424');
    expect(style.get(":global(:root[data-theme='light']) .root")?.['--pdf-desk']).toBe('#e8e8e8');
    expect(style.get('.pages')?.background).toBe('var(--pdf-desk)');
    expect(style.get('.page')?.background).toBe('white');
    expect(pdfCss).not.toContain('var(--preview-desk)');
    expect(style.get('.pages')?.background).not.toContain('accent');
  });
});
