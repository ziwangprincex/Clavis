import type { ClavisProjectConfig } from '../api/tauri';
import type { WritingOptions } from './rules';

export interface WritingPolicy extends WritingOptions {
  ignoredAcronymCount: number;
  termCount: number;
}

/** Converts the optional repository-owned writing policy into local analyzer options. */
export function writingPolicyFromConfig(config: ClavisProjectConfig | null | undefined): WritingPolicy {
  const writing = config?.writing;
  return {
    spelling: writing?.spelling ?? undefined,
    ignoredAcronyms: writing?.ignoredAcronyms ?? [],
    ignoredAcronymCount: writing?.ignoredAcronyms.length ?? 0,
    termCount: writing?.terms.length ?? 0,
  };
}

export function writingPolicySummary(policy: WritingPolicy): string {
  const parts: string[] = [];
  if (policy.spelling === 'us') parts.push('US spelling');
  else if (policy.spelling === 'uk') parts.push('UK spelling');
  else if (policy.spelling === 'mixed') parts.push('Mixed spelling');
  if (policy.ignoredAcronymCount > 0) parts.push(`${policy.ignoredAcronymCount} ignored acronym${policy.ignoredAcronymCount === 1 ? '' : 's'}`);
  if (policy.termCount > 0) parts.push(`${policy.termCount} saved project term${policy.termCount === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' \u00b7 ') : 'Default local writing checks';
}
