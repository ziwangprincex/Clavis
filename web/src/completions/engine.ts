import { detectCompletionSite } from './context';
import { latexSemanticProvider } from './latexSemanticProvider';
import { snippetProvider } from './snippetProvider';
import type {
  CompletionCandidate,
  CompletionProvider,
  CompletionRequest,
  CompletionResponse,
} from './types';

const DEFAULT_PROVIDERS: readonly CompletionProvider[] = [
  latexSemanticProvider,
  snippetProvider,
];

function mergeCandidates(groups: readonly (readonly CompletionCandidate[])[]): CompletionCandidate[] {
  const byKey = new Map<string, CompletionCandidate>();
  for (const candidate of groups.flat()) {
    const key = `${candidate.label}\u0000${candidate.insertText}`;
    const previous = byKey.get(key);
    if (!previous || (candidate.boost ?? 0) > (previous.boost ?? 0)) byKey.set(key, candidate);
  }
  return [...byKey.values()].sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0) || a.label.localeCompare(b.label));
}

/** Deep completion module. Callers provide a snapshot; providers stay internal. */
export async function complete(
  request: CompletionRequest,
  providers: readonly CompletionProvider[] = DEFAULT_PROVIDERS,
): Promise<CompletionResponse | null> {
  const site = detectCompletionSite(request);
  if (!site) return null;
  // Providers are fault-isolated: an unavailable language server must not
  // suppress built-in snippets or local Workspace semantics.
  const groups = await Promise.all(providers.map(async provider => {
    try {
      return await provider.complete(request, site);
    } catch {
      return [];
    }
  }));
  const candidates = mergeCandidates(groups);
  if (candidates.length === 0) return null;
  return { from: site.from, to: site.to, candidates };
}
