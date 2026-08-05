import { detectCompletionSite } from './context';
import { cwlProvider } from './cwlProvider';
import { latexSemanticProvider } from './latexSemanticProvider';
import { snippetProvider } from './snippetProvider';
import { typstProvider } from './typstProvider';
import type {
  CompletionCandidate,
  CompletionProvider,
  CompletionRequest,
  CompletionResponse,
  CompletionSite,
} from './types';

const DEFAULT_PROVIDERS: readonly CompletionProvider[] = [
  latexSemanticProvider,
  snippetProvider,
  cwlProvider,
  typstProvider,
];

/**
 * Merge provider results, keeping one candidate per label.
 *
 * Keyed on the label alone rather than label + insertText, because the cwl
 * corpus overlaps the built-in snippets: the corpus knows the itemize
 * environment exists but carries only its bare name, while `snippets.ts` has a
 * multi-line skeleton with an item and indentation. Those share a label and
 * differ in text, so a label+text key would list two near-identical entries.
 * Highest boost wins, which is how the richer snippet beats the corpus stub.
 */
function mergeCandidates(groups: readonly (readonly CompletionCandidate[])[]): CompletionCandidate[] {
  const byKey = new Map<string, CompletionCandidate>();
  for (const candidate of groups.flat()) {
    const previous = byKey.get(candidate.label);
    if (!previous || (candidate.boost ?? 0) > (previous.boost ?? 0)) byKey.set(candidate.label, candidate);
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
  const response = await completeAt(request, providers, site);
  if (response || site.kind !== 'keyval') return response;

  // A keyval site with no candidates is usually a misdetection rather than an
  // empty option list: an unclosed `[` to the left (`\left[`, `\item[term`) is
  // indistinguishable from a real option bracket, and because keyval is checked
  // before every other site, the false positive used to swallow the popup
  // entirely — no provider answers a keyval site it has no keys for, and an
  // empty candidate list means "no popup". Retry with keyval suppressed so the
  // position falls through to the command / word site it actually belongs to.
  const fallback = detectCompletionSite(request, true);
  if (!fallback) return null;
  return completeAt(request, providers, fallback);
}

async function completeAt(
  request: CompletionRequest,
  providers: readonly CompletionProvider[],
  site: CompletionSite,
): Promise<CompletionResponse | null> {
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
