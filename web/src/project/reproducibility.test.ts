import { expect, it } from 'vitest';
import { reproducibilityReport } from './reproducibility';
it('renders a bounded local diagnostic report', () => {
  const text = reproducibilityReport({ root: '/paper', issues: [], trust: 'trusted', hasExecutableTasks: false }, { root: '/paper', ok: true, checks: [{ id: 'config', status: 'ok', message: 'valid' }] }, null, [{ name: 'table', relativePath: 'out/table.tex', path: '/paper/out/table.tex', kind: 'table', status: 'ready', reason: 'up to date', sources: [] }], []);
  expect(text).toContain('# Clavis reproducibility report'); expect(text).toContain('[ready] out/table.tex'); expect(text).toContain('does not execute project tasks');
});
