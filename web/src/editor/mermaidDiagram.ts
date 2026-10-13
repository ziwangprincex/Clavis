// Mermaid diagrams for ```mermaid code fences, as Typora draws them. The
// library is loaded on first use, renders in its strict security mode (no
// scripts, no click handlers) and follows the editor's light or dark theme.

type Mermaid = typeof import('mermaid').default;

let library: Promise<Mermaid> | null = null;
/** Mermaid keeps global configuration and a scratch element, so renders run one at a time. */
let queue: Promise<unknown> = Promise.resolve();
const drawn = new Map<string, Promise<string>>();
const ready = new Map<string, string>();
let count = 0;

const keyOf = (source: string, dark: boolean) => `${dark}\0${source}`;

/** The SVG of a diagram already drawn, without waiting. */
export function drawnDiagram(source: string, dark: boolean): string | undefined {
  return ready.get(keyOf(source, dark));
}

/** SVG for a diagram; rejects with Mermaid's message when the source does not parse. */
export function drawDiagram(source: string, dark: boolean): Promise<string> {
  const key = keyOf(source, dark);
  let found = drawn.get(key);
  if (found) return found;
  found = queue.then(async () => {
    const mermaid = await (library ??= import('mermaid').then(module => module.default));
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'neutral',
      suppressErrorRendering: true,
    });
    const { svg } = await mermaid.render(`clavis-diagram-${++count}`, source);
    return svg;
  });
  queue = found.catch(() => undefined);
  drawn.set(key, found);
  // Bounded: drawings are small, but a long editing session makes many variants.
  if (drawn.size > 48) {
    const oldest = drawn.keys().next().value!;
    drawn.delete(oldest);
    ready.delete(oldest);
  }
  found.then(svg => { if (drawn.has(key)) ready.set(key, svg); }, () => drawn.delete(key));
  return found;
}
