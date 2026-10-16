// The managed :root token rule: one element, rewritten in place, always
// installed ahead of the user stylesheet so user.css keeps winning.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const children: { id?: string; textContent?: string }[] = [];
const fakeDocument = {
  head: { append: (node: object) => children.push(node) },
  createElement: () => ({ id: '', textContent: '' }),
  getElementById: (id: string) => children.find(node => node.id === id) ?? null,
};

const { ROOT_TOKENS_ID, setRootTokens } = await import('./rootTokens');

beforeEach(() => {
  children.length = 0;
  vi.stubGlobal('document', fakeDocument);
});
afterEach(() => vi.unstubAllGlobals());

describe('root token rule', () => {
  it('writes one rule and rewrites it in place', () => {
    setRootTokens({ '--bg': '#101010', '--text': '#eeeeee' });
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe(ROOT_TOKENS_ID);
    expect(children[0].textContent).toBe(':root { --bg: #101010; --text: #eeeeee; }');

    setRootTokens({ '--bg': '#202020' });
    expect(children).toHaveLength(1);
    expect(children[0].textContent).toBe(':root { --bg: #202020; }');
  });

  it('stays ahead of an already installed user stylesheet', () => {
    const user = { id: 'clavis-user-stylesheet', textContent: '', parentNode: {
      insertBefore: (node: object, anchor: object) => { children.splice(children.indexOf(anchor), 0, node as never); },
    } };
    children.push(user);
    setRootTokens({ '--bg': '#101010' });
    expect(children).toHaveLength(2);
    expect(children.indexOf(children.find(node => node.id === ROOT_TOKENS_ID)!))
      .toBeLessThan(children.indexOf(user));
  });

  it('is a no-op without a document', () => {
    vi.stubGlobal('document', undefined);
    expect(() => setRootTokens({ '--bg': '#101010' })).not.toThrow();
  });

  it('strips CSS sigils so a crafted value cannot close the rule early', () => {
    setRootTokens({ '--font-sans': 'x} * { display: none' });
    const rule = children[0].textContent!;
    // Exactly the opening and closing brace of the one :root rule survive.
    expect(rule.match(/[{}]/g)).toEqual(['{', '}']);
    expect(rule).toContain('--font-sans: x *  display: none;');
  });
});
