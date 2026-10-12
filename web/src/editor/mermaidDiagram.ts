// Mermaid diagrams for ```mermaid code fences, as Typora draws them. The
// library is loaded on first use, renders in its strict security mode (no
// scripts, no click handlers) and follows the editor's light or dark theme.

type Mermaid = typeof import('mermaid').default;

let library: Promise<Mermaid> | null = null;
/** Mermaid keeps global configuration and a scratch element, so renders run one at a time. */
let queue: Promise<unknown> = Promise.resolve();
const drawn = new Map<string, Promise<string>>();
let count = 0;

/** SVG for a diagram; rejects with Mermaid's message when the source does not parse. */
export function drawDiagram(source: string, dark: boolean): Promise<string> {
  const key = `${dark}\0${source}`;
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
  if (drawn.size > 48) drawn.delete(drawn.keys().next().value!);
  found.catch(() => drawn.delete(key));
  return found;
}
