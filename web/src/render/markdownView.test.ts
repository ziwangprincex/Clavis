import { expect, it } from 'vitest';
import { localImagePath } from './markdownView';

it('resolves images against the document, on macOS/Linux and Windows', () => {
  expect(localImagePath('images/a%20b.png', '/p/note.md')).toBe('/p/images/a b.png');
  expect(localImagePath('./fig.png', 'C:\\p\\note.md')).toBe('C:\\p/./fig.png');
  expect(localImagePath('../fig.png', '/p/chapters/note.md')).toBe('/p/chapters/../fig.png');
  expect(localImagePath('file:///etc/passwd', '/p/a.md')).toBeNull();
  expect(localImagePath('%00.png', '/p/a.md')).toBeNull();
});
