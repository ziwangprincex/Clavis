import { describe, expect, it } from 'vitest';
import { writingPolicyFromConfig, writingPolicySummary } from './options';

describe('project writing policy', () => {
  it('maps optional project config into analyzer options and a clear summary', () => {
    const policy = writingPolicyFromConfig({
      project: {}, latex: {}, paths: { generated: [], ignored: [] }, tasks: {},
      writing: { spelling: 'us', ignoredAcronyms: ['GDP', 'IV'], terms: ['heteroskedasticity'] },
    });
    expect(policy).toMatchObject({ spelling: 'us', ignoredAcronyms: ['GDP', 'IV'], ignoredAcronymCount: 2, termCount: 1 });
    expect(writingPolicySummary(policy)).toBe('US spelling \u00b7 2 ignored acronyms \u00b7 1 saved project term');
  });

  it('keeps an absent policy neutral', () => {
    expect(writingPolicySummary(writingPolicyFromConfig(undefined))).toBe('Default local writing checks');
  });
});
