import type { CompletionRequest, CompletionSite } from './types';

const COMMANDS_WITH_CITATIONS = new Set(['cite', 'citep', 'citet', 'autocite', 'parencite', 'textcite']);
const COMMANDS_WITH_REFERENCES = new Set(['ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref']);
const COMMANDS_WITH_FILES = new Set(['input', 'include', 'subfile', 'includegraphics', 'bibliography', 'addbibresource']);
const COMMANDS_WITH_PACKAGES = new Set(['usepackage', 'RequirePackage']);
const COMMANDS_WITH_CLASSES = new Set(['documentclass']);

function siteKindForCommand(command: string): 'citation' | 'reference' | 'file' | 'package' | 'class' | null {
  if (COMMANDS_WITH_CITATIONS.has(command)) return 'citation';
  if (COMMANDS_WITH_REFERENCES.has(command)) return 'reference';
  if (COMMANDS_WITH_FILES.has(command)) return 'file';
  if (COMMANDS_WITH_PACKAGES.has(command)) return 'package';
  if (COMMANDS_WITH_CLASSES.has(command)) return 'class';
  return null;
}

function argumentSite(before: string): CompletionSite | null {
  // Optional arguments tolerate one level of nesting (`\cite[p. [3]]{...}`).
  // The mandatory argument may span lines, because multi-key lists are commonly
  // wrapped:  \cite{knuth1984,
  //                 lamport1994}
  const match = /\\([A-Za-z@]+)(?:\[(?:[^[\]]|\[[^[\]]*\])*\])*\{([^{}]*)$/.exec(before);
  if (!match) return null;

  const command = match[1];
  const argument = match[2];
  const kind = siteKindForCommand(command);
  // Only the final segment is the query. Citations/references split on commas
  // and whitespace; file paths may contain spaces, so those split on commas and
  // line breaks only. A newline always ends a segment.
  const lastOf = (...needles: string[]) =>
    Math.max(...needles.map(needle => argument.lastIndexOf(needle)));
  const segmentStart = (kind === 'file'
    ? lastOf(',', '\n', '\r')
    : lastOf(',', ' ', '\t', '\n', '\r')) + 1;
  const query = argument.slice(segmentStart);
  const from = before.length - query.length;
  const to = before.length;

  if (kind === 'citation') return { kind, from, to, query };
  if (kind === 'reference') return { kind, from, to, query };
  if (kind === 'file') return { kind, from, to, query, command };
  if (kind === 'package') return { kind, from, to, query };
  if (kind === 'class') return { kind, from, to, query };
  return null;
}

export function detectCompletionSite(request: CompletionRequest): CompletionSite | null {
  const before = request.text.slice(0, request.position);

  if (request.language === 'latex') {
    // Key/value options: the cursor sits inside the optional-argument brackets
    // of a command or environment (`\includegraphics[wi`, `\begin{Form}[t`).
    // Closed bracket pairs are consumed by the `(?:\[[^[\]]*\])*` group, so
    // only an open `[` matches. `\[` display-math is a single punctuation
    // character, not `[A-Za-z@]`, so it cannot match this pattern.
    const keyval = /\\([A-Za-z@]+\*?|begin\{[^{}]*\}|end\{[^{}]*\})(?:\[[^[\]]*\])*\[([^[\]]*)$/.exec(before);
    if (keyval) {
      return {
        kind: 'keyval',
        from: request.position - keyval[2].length,
        to: request.position,
        query: keyval[2],
        command: `\\${keyval[1]}`,
      };
    }

    const argument = argumentSite(before);
    if (argument) return argument;

    // Environment names routinely contain digits and underscores (`align2`,
    // `my_env`), so the charset must be wider than plain letters.
    const environment = /\\(begin|end)\{([A-Za-z0-9_*.-]*)$/.exec(before);
    if (environment) {
      // closeBrackets() may already have inserted the closing brace while the
      // user typed `\begin{doc`. Consume it so accepting a snippet cannot leave
      // a stray `}`. The regex guarantees `\begin{<name>` sits immediately
      // before the cursor, so a `}` here can only be this argument's own brace.
      return {
        kind: 'environment',
        action: environment[1] as 'begin' | 'end',
        from: request.position - environment[0].length,
        to: request.text[request.position] === '}' ? request.position + 1 : request.position,
        query: environment[2],
      };
    }
  }

  const command = /\\[A-Za-z@]*$/.exec(before);
  if (command) {
    if (command[0] === '\\' && !request.explicit) return null;
    return {
      kind: 'command',
      from: request.position - command[0].length,
      to: request.position,
      query: command[0],
    };
  }

  const word = /[A-Za-z#][\w.-]*$/.exec(before);
  if (!word) return null;
  return {
    kind: 'word',
    from: request.position - word[0].length,
    to: request.position,
    query: word[0],
  };
}
