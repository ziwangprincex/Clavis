// Find-or-create semantics shared by the managed <style> elements — today the
// runtime token rule (#clavis-tokens) and the user stylesheet — so the two
// cannot drift apart on where and how they land in <head>. The cascade
// contract they implement: token rule first, user stylesheet after it, so
// user.css wins without needing !important.

export function managedStyleElement(id: string, beforeId?: string): HTMLStyleElement | null {
  // Tests run without a DOM; there is nothing to inject there.
  if (typeof document === 'undefined') return null;
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = Object.assign(document.createElement('style'), { id });
    // With beforeId, stay ahead of that element so the one injected after it
    // (the user stylesheet) keeps winning; otherwise append last, ahead of
    // nothing.
    const anchor = beforeId ? document.getElementById(beforeId) : null;
    if (anchor?.parentNode) anchor.parentNode.insertBefore(style, anchor);
    else document.head.append(style);
  }
  return style;
}
