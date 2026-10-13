import { describe, expect, it } from 'vitest';
import { markdownDocument, markdownHeadings, markdownInline, sanitizeUrl } from './markdown';
import { parseOutline } from '../store/outline';

describe('inline Markdown (table cells) respects syntax', () => {
  it('preserves code and renders math outside it', () => {
    expect(markdownInline('`$HOME$`')).toContain('<code>$HOME$</code>');
    expect(markdownInline('`$HOME$`')).not.toContain('class="katex');
    expect(markdownInline('Math $x+1$ here.')).toContain('class="katex');
  });
  it('does not reinterpret escaped dollars or currency', () => {
    expect(markdownInline('\\$HOME\\$ and $5 and $10.')).not.toContain('class="katex');
  });
  it('does not replace dollars inside URLs', () => {
    const html = markdownInline('[url](https://example.com/$HOME$)');
    expect(html).toContain('href="https://example.com/$HOME$"');
    expect(html).not.toContain('class="katex');
  });
  it('keeps raw HTML and dangerous URLs disabled', () => {
    const html = markdownInline('<script>alert(1)</script> [x](javascript:alert) ![x](data:image/svg+xml;base64,PHN2Zz4=)');
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
    expect(parseOutline(source, 'markdown')).toEqual(headings.map(({ level, title, line }) => ({ level, title, line })));
  });
  it('nested headings do not enter the outline', () => {
    expect(markdownHeadings('> # Quote\n\n# Real')).toEqual([{ line: 3, title: 'Real', level: 0, id: 'real' }]);
  });
  it('uses visible text for formatting and links in a heading', () => {
    expect(markdownHeadings('# **Hello** [world](https://example.com)')[0].id).toBe('hello-world');
  });
  it('isolates slug counters between calls', () => {
    expect(markdownHeadings('# Intro')).toEqual(markdownHeadings('# Intro'));
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

describe('whole-document export rendering', () => {
  const source = [
    '---', 'title: "My Draft"', '---', '',
    '# Intro', '', 'A claim[^a] and ==key== text, $x^2$.', '',
    '> [!TIP]', '> Save often.', '',
    '```mermaid', 'graph LR; A-->B', '```', '',
    '<script>alert(1)</script>', '',
    '[^a]: The **source**.', '',
  ].join('\n');

  it('keeps anchors, footnotes, callouts and diagrams, and drops raw HTML', () => {
    const { title, html } = markdownDocument(source);
    expect(title).toBe('My Draft');
    expect(html).toContain('<h1 id="intro">Intro</h1>');
    expect(html).toContain('<sup class="footnote-ref"><a href="#fn-a">1</a></sup>');
    expect(html).toContain('<li id="fn-a" value="1">The <strong>source</strong>.</li>');
    expect(html).toContain('<blockquote class="callout callout-tip"><p class="callout-title">');
    expect(html).toContain('<p>Save often.</p>');
    expect(html).toContain('data-diagram="graph LR; A--&gt;B"');
    expect(html).toContain('<mark>key</mark>');
    expect(html).toContain('<math');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('title:');
  });

  it('falls back to the first heading for the title', () => {
    expect(markdownDocument('## Notes\n\nText').title).toBe('Notes');
  });
});

describe('export fixes after 1.8.0', () => {
  it('numbers footnotes by first use even when one has no definition', () => {
    const { html } = markdownDocument('A[^gone] and B[^b].\n\n[^b]: Defined.\n');
    expect(html).toContain('<a href="#fn-b">2</a>');
    expect(html).toContain('<li id="fn-b" value="2">Defined.</li>');
  });

  it('makes a callout only from [!KIND] alone on the first line, as the editor does', () => {
    expect(markdownDocument('> [!NOTE] Title\n> text\n').html).not.toContain('callout');
    expect(markdownDocument('> [!NOTE]\n> text\n').html).toContain('callout-note');
  });
});
