// A cascade guard the DOM-less unit tests cannot provide: the pre-hydration
// fallback must never match at runtime. A :root[data-theme='…'] block in
// tokens.css would always match (JS sets the attribute on <html>) and, with
// its higher specificity, silently freeze the whole palette on these static
// values — the runtime #clavis-tokens rule, the settings accent, and the
// editor surface reading var(--bg) would all lose to it.
import css from './tokens.css?raw';
import { describe, expect, it } from 'vitest';

describe('token fallbacks', () => {
  it('are gated to pre-hydration only', () => {
    // Comments may discuss the forbidden selector form; only rules count.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).toContain(':root:not([data-theme])');
    expect(rules).not.toMatch(/:root\[data-theme/);
  });
});
