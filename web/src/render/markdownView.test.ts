import { expect, it } from 'vitest';
import { localImagePath } from './markdownView';

it('resolves images against the document, on macOS/Linux and Windows', () => {
  expect(localImagePath('images/a%20b.png', '/p/note.md')).toBe('/p/images/a b.png');
  // `.` and `..` resolve, so a link to an open file matches its tab.
  expect(localImagePath('./fig.png', 'C:\\p\\note.md')).toBe('C:/p/fig.png');
  expect(localImagePath('../b.md', '/p/chapters/note.md')).toBe('/p/b.md');
  expect(localImagePath('../../../x.md', '/p/note.md')).toBe('/../../x.md');
  expect(localImagePath('file:///etc/passwd', '/p/a.md')).toBeNull();
  expect(localImagePath('%00.png', '/p/a.md')).toBeNull();
});
