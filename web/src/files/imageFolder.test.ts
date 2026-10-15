import { describe, expect, it } from 'vitest';
import { frontmatterImageFolder } from './imageFolder';

describe('image folder from front matter', () => {
  it('reads Typora\'s key and the plain one, quoted or not', () => {
    expect(frontmatterImageFolder('---\ntitle: A\ntypora-copy-images-to: ./figures\n---\n# A')).toBe('./figures');
    expect(frontmatterImageFolder('---\nimage-folder: "../shared images"\n---\n')).toBe('../shared images');
  });

  it('ignores the key outside front matter and empty values', () => {
    expect(frontmatterImageFolder('# A\ntypora-copy-images-to: ./figures\n')).toBeNull();
    expect(frontmatterImageFolder('---\ntitle: A\ntypora-copy-images-to:\n---\n')).toBeNull();
  });
});
