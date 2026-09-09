import { describe, expect, it } from 'vitest';
import { markdownHeadings, markdownWithMath, sanitizeUrl } from './markdown';
import { parseOutline } from '../store/outline';

describe('Markdown math respects syntax', () => {
  it.each(['`$HOME$`', '```sh\necho "$HOME$"\n```', '~~~\n$$code$$\n~~~', '    $HOME$'])('preserves code: %s', source => {
    const html = markdownWithMath(source);
    expect(html).not.toContain('class="katex');
    expect(html).toContain(source.includes('$$code$$') ? '$$code$$' : '$HOME$');
    expect(html).toContain('<code');
  });
  it('renders inline and display math outside code', () => {
    expect(markdownWithMath('Math $x+1$ here.')).toContain('class="katex');
    expect(markdownWithMath('$$\nx^2\n$$')).toContain('katex-display');
    expect(markdownWithMath('Before $$x^2$$ after')).toContain('katex-display');
  });
  it('does not reinterpret escaped dollars or currency', () => {
    expect(markdownWithMath('\\$HOME\\$ and $5 and $10.')).not.toContain('class="katex');
  });
  it('does not replace dollars inside URLs or image attributes', () => {
    const html = markdownWithMath('[url](https://example.com/$HOME$) ![$x$](images/$HOME$.png)');
    expect(html).toContain('href="https://example.com/$HOME$"');
    expect(html).toContain('data-local-image="images/$HOME$.png"');
    expect(html).not.toContain('class="katex');
  });
  it('keeps raw HTML and dangerous URLs disabled', () => {
    const html = markdownWithMath('<script>alert(1)</script>\n\n[x](javascript:alert) ![x](data:image/svg+xml;base64,PHN2Zz4=)');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:image/svg');
  });
});

describe('Markdown anchors and source outline agree', () => {
  it('includes ATX, setext and Chinese headings and ignores fenced headings', () => {
    const source = '# Intro\n\n```\n# ignored\n```\n\n中文标题\n-----\n\n## Intro\n\n## Intro-1\n\n## Intro';
    const headings = markdownHeadings(source);
    expect(headings.map(h => h.id)).toEqual(['intro', '中文标题', 'intro-1', 'intro-1-1', 'intro-2']);
    expect(headings.map(h => h.line)).toEqual([1, 7, 10, 12, 14]);
    const html = markdownWithMath(source);
    for (const h of headings) expect(html).toContain(`id="${h.id}" data-source-line="${h.line}"`);
    expect(parseOutline(source, 'markdown')).toEqual(headings.map(({ level, title, line }) => ({ level, title, line })));
  });
  it('nested headings do not steal top-level anchors', () => {
    const html = markdownWithMath('> # Quote\n\n# Real');
    expect(html).toContain('<h1>Quote</h1>');
    expect(html).toContain('<h1 id="real" data-source-line="3">Real</h1>');
  });
  it('uses visible text for formatting and links in a heading', () => {
    expect(markdownHeadings('# **Hello** [world](https://example.com)')[0].id).toBe('hello-world');
  });
  it('isolates slug counters between renders', () => {
    expect(markdownWithMath('# Intro')).toBe(markdownWithMath('# Intro'));
  });
});

describe('URL policy', () => {
  it.each(['images/plot.png', './images/plot.png', '../images/plot.png', '图片/结果.png', '#intro', 'https://example.com/a.png'])('permits %s', url => {
    expect(sanitizeUrl(url, true)).toBe(url);
  });
  it.each(['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '//example.com/a', '\\server\\a'])('rejects %s', url => {
    expect(sanitizeUrl(url, true)).toBe('');
  });
  it('keeps safe raster data images but not mailto images', () => {
    expect(sanitizeUrl('data:image/png;base64,aGVsbG8=', true)).toContain('data:image/png');
    expect(sanitizeUrl('mailto:a@b.com', true)).toBe('');
    expect(sanitizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
  });
});
