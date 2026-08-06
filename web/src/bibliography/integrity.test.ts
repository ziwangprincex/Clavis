import { expect, it } from 'vitest';
import { citationIntegrity } from './integrity';
it('separates missing project citation keys from unused bibliography entries', () => {
  const result = citationIntegrity([{ key: 'used' }, { key: 'unused' }] as never, [{ key: 'used', namespace: 'citation', role: 'usage' }, { key: 'missing', namespace: 'citation', role: 'usage' }] as never);
  expect(result).toEqual({ missingKeys: ['missing'], unusedKeys: ['unused'] });
});
