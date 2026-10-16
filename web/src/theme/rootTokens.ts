// The runtime `:root` token rule, kept in one managed <style> element.
//
// An inline style on documentElement would beat every author rule, forcing
// user.css to mark each token `!important` (the example shown in Settings does
// not). A stylesheet rule instead: it lands after the pre-hydration fallbacks
// in tokens.css (gated to :root:not([data-theme]), see that file), and the
// user stylesheet — injected after Clavis's own styles — wins over it in turn,
// exactly as the Settings hint promises. The bare :root selector keeps the
// specificity at (0,1,0) so plain ':root' rules in user.css outrank it by
// document order alone.

import { managedStyleElement } from './managedStylesheet';
import { USER_STYLESHEET_ID } from './userStylesheet';

export const ROOT_TOKENS_ID = 'clavis-tokens';

/** Write `decls` as the whole `:root` token rule, replacing any previous one. */
export function setRootTokens(decls: Record<string, string>): void {
  const style = managedStyleElement(ROOT_TOKENS_ID, USER_STYLESHEET_ID);
  if (!style) return;
  // Settings-derived strings are interpolated into a rule, so the CSS sigils
  // ('{};') are stripped: a font family entered as 'x} * { display: none'
  // must not close the rule early and silently drop every declaration after
  // it. No legitimate token value here contains those characters.
  const clean = (text: string) => text.replace(/[{};]/g, '');
  style.textContent = `:root { ${Object.entries(decls)
    .map(([key, value]) => `${clean(key)}: ${clean(value)};`)
    .join(' ')} }`;
}
