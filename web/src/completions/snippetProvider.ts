import { snippetsForLang } from './snippets';
import { inTypstMath, isCommonTypstName } from './typstProvider';
import { detectMathContext } from './mathContext';
import { latexProvides } from './cwlProvider';
import type { CompletionCandidate, CompletionProvider } from './types';

/**
 * Sites whose argument is a name from a known set — a bib key, a label, a path,
 * a package, an option key — never a snippet.
 *
 * Listed explicitly rather than left to the label filter below: every LaTeX
 * snippet happens to start with `\` today, so the filter drops them anyway, but
 * that is a coincidence. One snippet without a backslash would start leaking
 * into `\usepackage{`.
 */
const NON_SNIPPET_SITES = new Set(['citation', 'reference', 'file', 'package', 'class', 'keyval']);

/**
 * Boosts for a curated snippet.
 *
 * `mergeCandidates` keys on the label and keeps the highest boost, so these have
 * to interleave with `typstProvider`'s (see its table) rather than sit above them
 * wholesale. Two things must hold at once:
 *
 *  - Where a curated entry and a generated one describe the same function, the
 *    curated template wins: it encodes an authoring idiom no signature can
 *    express (`#figure(image("path.png"), caption: [caption])`).
 *  - Ordering within the curated set must not fall back to the alphabet, or
 *    `#align`, `#block`, `#box` fill the first screen and `#heading` is nowhere.
 *
 * Hence two tiers, one per side of the common/uncommon split, each a step above
 * the generated candidate it may collide with.
 */
const SNIPPET_BOOST_COMMON = 3;
const SNIPPET_BOOST = -2;

export const snippetProvider: CompletionProvider = {
  complete(request, site) {
    if (NON_SNIPPET_SITES.has(site.kind)) return [];
    // Typst has two syntaxes, and a candidate valid in one is wrong in the other:
    // markup calls carry a leading `#` (`#figure`), while math is its own scope
    // written without one (`frac(a, b)`, `alpha`). The completion site starts at
    // the `#`, and CodeMirror filters labels against the replaced range, so a
    // bare `box` label would never survive a `#box` query — hence the prefixing
    // below, which also makes the label collide with the generated candidate so
    // this curated form wins on boost.
    const typst = request.language === 'typst';
    const math = typst && inTypstMath(request.text, request.position);
    const latex = request.language === 'latex';
    const latexContext = latex
      ? detectMathContext(request.text, request.position)
      : { math: false, envs: [] as string[] };
    const latexMath = latexContext.math;

    return snippetsForLang(request.language)
      .filter(item => {
        if (typst && !!item.math !== math) return false;
        if (latex && item.latexPackage && !latexProvides(request.text, item.latexPackage)) return false;
        if (latex && item.latexInsideMath && !latexMath) return false;
        if (latex && item.latexEnvs && !item.latexEnvs.some(env => latexContext.envs.includes(env))) return false;
        if (latex && site.kind === 'environment' && latexMath && !item.latexInsideMath) return false;
        if (site.kind === 'environment') {
          return site.action === 'begin' && item.l.startsWith('\\begin{');
        }
        if (site.kind === 'command') return item.l.startsWith('\\');
        return !item.l.startsWith('\\');
      })
      .map<CompletionCandidate>(item => {
        // Math entries are already written the way they are typed inside `$...$`.
        const prefix = typst && !math && !item.l.startsWith('#') ? '#' : '';
        const label = `${prefix}${item.l}`;
        return {
          label,
          insertText: `${prefix}${item.t}`,
          detail: item.d,
          kind: 'snippet',
          snippet: true,
          boost: typst && isCommonTypstName(item.l, math) ? SNIPPET_BOOST_COMMON : SNIPPET_BOOST,
        };
      });
  },
};
