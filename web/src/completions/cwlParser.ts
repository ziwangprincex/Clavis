/**
 * Parser for TeXstudio `.cwl` (completion word list) files.
 *
 * The `.cwl` format originated in Kile and was extended by TeXstudio to carry
 * argument placeholders and semantic classifiers. It is the only
 * machine-readable index of LaTeX package commands that exists — LaTeX itself
 * ships `.sty` macros and PDF prose, nothing structured. Format reference:
 * TeXstudio user manual §7.3, plus behaviour observed across the real 4465-file
 * corpus (which contains constructs the manual does not document, noted below).
 *
 * This module is pure: text in, structures out, no IO. Loading and caching live
 * in `cwlProvider.ts`.
 *
 * Security posture: parsed templates become text inserted into the user's
 * document, so parsing is whitelist-only. A line whose shape we do not
 * recognise is dropped rather than passed through, and shell-escape
 * constructs are rejected outright.
 */

/** A command entry, e.g. `\frac{num}{den}#m`. */
export interface CwlCommand {
  /** Command name without the backslash, e.g. `frac`. */
  name: string;
  /** Display label including the backslash, e.g. `\frac`. */
  label: string;
  /** CodeMirror 6 snippet text, e.g. `\frac{${1:num}}{${2:den}}`. */
  snippet: string;
  /** Whether `snippet` contains placeholder fields. */
  hasFields: boolean;
  /** `#m` — valid only in math mode. */
  mathOnly: boolean;
  /** `#n` — valid only outside math mode. */
  textOnly: boolean;
  /** `#t` — valid only in tabular-like environments. */
  tabularOnly: boolean;
  /** `#*` — unusual; TeXstudio hides these behind an "all" tab. We downrank. */
  unusual: boolean;
  /** `/env1,env2` — valid only inside these environments. */
  envs: readonly string[] | null;
}

/** An environment entry, e.g. `\begin{array}{cols}#m`. */
export interface CwlEnvironment {
  /** Environment name, e.g. `array`. */
  name: string;
  /** Display label, e.g. `\begin{array}`. */
  label: string;
  /** CM6 snippet expanding to a `\begin`/`\end` pair. */
  snippet: string;
  mathOnly: boolean;
  unusual: boolean;
  /** `#\math`, `#m\array` — environment aliases (treated like these envs). */
  aliases: readonly string[];
}

export interface CwlPackage {
  /** Package name, i.e. the filename without `.cwl`. */
  name: string;
  /** `#include:` — packages this one pulls in. */
  deps: readonly string[];
  commands: readonly CwlCommand[];
  environments: readonly CwlEnvironment[];
  /** `#keyvals:` blocks — option key names for commands/environments. */
  keyvals: readonly CwlKeyvals[];
  /** Lines we could not classify. Surfaced for tests, not for users. */
  droppedLines: number;
}

/**
 * One `#keyvals:` block, expanded to a single command.
 *
 * A header may list several commands (`#keyvals:\pagestyle#c,\thispagestyle#c`);
 * each expands to its own `CwlKeyvals` sharing the same keys. The optional
 * `/pkg` qualifier (`#keyvals:\usepackage/biblatex#c`) records which package
 * the option set belongs to, which completion surfaces as the candidate detail.
 */
export interface CwlKeyvals {
  /** Command as written in the header, e.g. `\usepackage` or `\begin{Form}`. */
  command: string;
  /** Package qualifier from `/pkg`, if any (`biblatex` for the example above). */
  pkg: string | null;
  /** Option key names. */
  keys: readonly string[];
}

/**
 * Shell-escape and file-writing primitives. A malicious or compromised cwl
 * could otherwise smuggle `\write18{...}` into a template the user then
 * compiles. The Rust side already hardens shell-escape handling; this keeps the
 * frontend from opening a second door.
 *
 * The guard is a letter-boundary lookahead rather than `\b`, because `\openout1`
 * puts a digit right after the name and `\b` would not fire there.
 */
const FORBIDDEN = /\\(write|immediate|openout|special|input@path|catcode)(?![a-zA-Z])/i;

/** Environment names that put their body in math mode, for alias resolution. */
const MATH_ALIASES = new Set(['math', 'displaymath', 'array']);

const CLASSIFIER_LETTERS = 'aAbBcCdDgiIKlLmMnNrsStTuUvVW0123456789';

/**
 * Split a cwl line into its command part and classifier part at the first
 * unescaped `#`. Returns null when the line has no classifier.
 *
 * `\#` is itself a valid LaTeX command, so a backslash-escaped hash must not be
 * mistaken for the separator.
 */
function splitClassifier(line: string): { body: string; classifier: string | null } {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '#') continue;
    if (i > 0 && line[i - 1] === '\\') continue;
    return { body: line.slice(0, i), classifier: line.slice(i + 1) };
  }
  return { body: line, classifier: null };
}

interface Classification {
  mathOnly: boolean;
  textOnly: boolean;
  tabularOnly: boolean;
  unusual: boolean;
  hidden: boolean;
  envs: string[] | null;
  aliases: string[];
}

/**
 * Parse a classifier such as `m`, `*m`, `mM`, `m\array`, `/algorithm`,
 * `\math,array`. Letters, an optional `/env,env` restriction, and an optional
 * `\alias,alias` list may all appear in one classifier.
 */
function parseClassifier(raw: string | null): Classification {
  const out: Classification = {
    mathOnly: false,
    textOnly: false,
    tabularOnly: false,
    unusual: false,
    hidden: false,
    envs: null,
    aliases: [],
  };
  if (!raw) return out;

  // Peel off `/env,env` and `\alias,alias` tails before reading letters, since
  // env names contain letters that would otherwise look like classifiers.
  let letters = '';
  let unusual = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '/') {
      // `/env1,env2` runs to the next `\` or end of string.
      const rest = raw.slice(i + 1);
      const stop = rest.indexOf('\\');
      const envPart = stop === -1 ? rest : rest.slice(0, stop);
      out.envs = envPart.split(',').map(s => s.trim()).filter(Boolean);
      i += envPart.length;
      continue;
    }
    if (ch === '\\') {
      out.aliases = raw
        .slice(i + 1)
        .split(',')
        .map(s => s.trim().replace(/^\\/, ''))
        .filter(Boolean);
      break;
    }
    // `*` marks "unusual" and may precede other flags (`#*m`). It is tracked
    // separately because it is punctuation, not one of the classifier letters.
    if (ch === '*') unusual = true;
    else if (CLASSIFIER_LETTERS.includes(ch)) letters += ch;
  }

  // Uppercase/lowercase are distinct: `m` is math-only, `M` suppresses use as a
  // description. Only the flags we act on are read; the rest are ignored.
  //
  // These read `letters`, not `raw`, on purpose: `letters` excludes the `/env`
  // and `\alias` tails, whose names contain ordinary letters. Testing `raw` for
  // `S` would silently hide every command in an environment starting with a
  // capital S (`#/Sidebar`), and testing it for `*` would misread a `%<...%>`
  // marker. The corpus has no such env today, but it gains files continuously.
  if (letters.includes('m')) out.mathOnly = true;
  if (letters.includes('n')) out.textOnly = true;
  if (letters.includes('t')) out.tabularOnly = true;
  if (letters.includes('S')) out.hidden = true;
  if (unusual) out.unusual = true;
  if (out.aliases.some(a => MATH_ALIASES.has(a))) out.mathOnly = true;

  return out;
}

/**
 * Convert a cwl argument body into CM6 placeholder text.
 *
 * cwl markers, all observed in the real corpus:
 *   `%|`                      cursor stop with no placeholder text
 *   `%<name%>`                explicit placeholder covering part of an argument
 *   `%<name%:translatable%>`  same, with a translation hint we discard
 *   `%\`                      newline
 */
function convertArgumentBody(body: string, nextField: () => number): string {
  // Strip translation hints first so the placeholder name stays clean.
  let text = body.replace(/%:([^%]*)%>/g, '%>');

  let out = '';
  let i = 0;
  let sawMarker = false;

  while (i < text.length) {
    if (text.startsWith('%|', i)) {
      out += `\${${nextField()}}`;
      i += 2;
      sawMarker = true;
      continue;
    }
    if (text.startsWith('%<', i)) {
      const end = findMarkerEnd(text, i);
      if (end === -1) break; // Unterminated marker — treat rest as literal.
      const name = text.slice(i + 2, end);
      out += name ? `\${${nextField()}:${escapeField(name)}}` : `\${${nextField()}}`;
      i = end + 2;
      sawMarker = true;
      continue;
    }
    if (text.startsWith('%\\', i)) {
      out += '\n';
      i += 2;
      continue;
    }
    out += text[i];
    i++;
  }

  // No explicit marker: the whole argument is the placeholder, which is the
  // format's default (`\section{title}` -> `\section{${1:title}}`).
  if (!sawMarker) {
    const name = stripResidualMarkers(out).trim();
    return name ? `\${${nextField()}:${escapeField(name)}}` : `\${${nextField()}}`;
  }
  return stripResidualMarkers(out);
}

/**
 * Locate the `%>` that closes a `%<` marker opened at `open`.
 *
 * A placeholder name never contains another marker, so a `%<` appearing first
 * means this marker was left unterminated upstream — a real case is
 * `pst-bspline.cwl` writing `%<x2,y2%)` with `%)` instead of `%>`. Scanning on
 * to the distant `%>` there would swallow raw cwl syntax into the field name.
 */
function findMarkerEnd(text: string, open: number): number {
  const end = text.indexOf('%>', open + 2);
  if (end === -1) return -1;
  const nextOpen = text.indexOf('%<', open + 2);
  if (nextOpen !== -1 && nextOpen < end) return -1;
  return end;
}

/**
 * Last line of defence: raw cwl markers must never reach the user's document.
 * Malformed upstream lines can leave stray `%<`/`%>`/`%|` behind.
 */
function stripResidualMarkers(text: string): string {
  return text.replace(/%[<>|]/g, '');
}

/** CM6 reads `${` as a field opener and unescapes `\{`/`\}`, so guard those. */
function escapeField(text: string): string {
  return text.replace(/\$\{/g, '$\\{').replace(/\}/g, '\\}');
}

/**
 * Convert cwl placeholder markers in free text (not inside `{}`/`[]`).
 *
 * Needed because markers are not confined to arguments: `\left(%|\right)` puts
 * the cursor stop between bare parentheses, and `\verb|%<text%>|` uses a
 * delimiter pair. Unlike argument bodies, text with no marker stays literal —
 * we must not turn `\right)` into a placeholder.
 */
function convertFreeText(text: string, nextField: () => number): string {
  if (!text.includes('%')) return text;
  const stripped = text.replace(/%:([^%]*)%>/g, '%>');

  let out = '';
  let i = 0;
  while (i < stripped.length) {
    if (stripped.startsWith('%|', i)) {
      out += `\${${nextField()}}`;
      i += 2;
      continue;
    }
    if (stripped.startsWith('%<', i)) {
      const end = findMarkerEnd(stripped, i);
      if (end === -1) {
        // Unterminated upstream: keep the words, drop the marker punctuation.
        out += stripResidualMarkers(stripped.slice(i));
        break;
      }
      const name = stripped.slice(i + 2, end);
      out += name ? `\${${nextField()}:${escapeField(name)}}` : `\${${nextField()}}`;
      i = end + 2;
      continue;
    }
    if (stripped.startsWith('%\\', i)) {
      out += '\n';
      i += 2;
      continue;
    }
    out += stripped[i];
    i++;
  }
  return stripResidualMarkers(out);
}

/**
 * Scan a run of `{...}`/`[...]` arguments into a CM6 snippet.
 * Returns null when brackets are unbalanced.
 */
function scanArguments(tail: string): { args: string; rest: string; fields: number } | null {
  let field = 0;
  const nextField = () => ++field;
  let args = '';
  let rest = tail;

  for (;;) {
    // Markers can sit between arguments, e.g. `\left(%|\right)`.
    const open = rest[0];
    if (open !== '{' && open !== '[') break;
    const close = open === '{' ? '}' : ']';
    // Arguments may nest one level (`\cite[p. [3]]{...}`), so track depth
    // rather than scanning for the first closer.
    let depth = 0;
    let end = -1;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (ch === '\\') { i++; continue; }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return null;
    args += open + convertArgumentBody(rest.slice(1, end), nextField) + close;
    rest = rest.slice(end + 1);
  }

  // Whatever trails the arguments may still hold markers.
  return { args, rest: convertFreeText(rest, nextField), fields: field };
}

interface ParsedTemplate {
  /** Command or environment name without the backslash. */
  name: string;
  /** CM6 snippet for everything after the name. */
  argSnippet: string;
  hasFields: boolean;
  /** Text trailing the arguments, e.g. the `\item` in `\begin{enumerate}\item`. */
  trailer: string;
}

/**
 * Parse `\name{arg}[opt]...` into a name plus a CM6 argument snippet.
 * Returns null when the line is not a shape we recognise.
 */
function parseTemplate(body: string): ParsedTemplate | null {
  if (!body.startsWith('\\')) return null;

  // A command name is either letters (`\frac`, `\@ifundefined`) or a single
  // punctuation char (`\#`, `\$`, `\,`, `\|`).
  const nameMatch = /^\\([A-Za-z@]+\*?|.)/.exec(body);
  if (!nameMatch) return null;

  const scanned = scanArguments(body.slice(nameMatch[0].length));
  if (!scanned) return null; // Unbalanced — drop the line.

  return {
    name: nameMatch[1],
    argSnippet: scanned.args,
    // Markers in the trailer create fields too (`\left(%|\right)`), so read the
    // rendered text rather than the bracket-argument count alone.
    hasFields: scanned.fields > 0 || scanned.rest.includes('${'),
    trailer: scanned.rest,
  };
}

/** Environment bodies get one indent level and a final cursor stop. */
function buildEnvironmentSnippet(name: string, args: string, trailer: string, field: number): string {
  // `\begin{enumerate}\item` in the corpus signals that the body wants an
  // `\item`; the manual does not document this but latex-document.cwl uses it.
  const body = trailer.trim() === '\\item' ? `\\item \${${field}}` : `\${${field}}`;
  return `\\begin{${name}}${args}\n\t${body}\n\\end{${name}}`;
}

/**
 * Parse a `#keyvals:` header: comma-separated `\cmd[/pkg][#class]` entries.
 *
 * Real forms: `\pagestyle#c`, `\usepackage/biblatex#c`, `\begin{filecontents}`.
 * The classification tail (`#c`, ...) and the `/pkg` qualifier are both
 * optional; everything after a `#` is discarded, then the `/pkg` qualifier is
 * split off the command name.
 */
function parseKeyvalsHeader(header: string): { command: string; pkg: string | null }[] {
  const out: { command: string; pkg: string | null }[] = [];
  for (const raw of header.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const hash = part.indexOf('#');
    const core = (hash === -1 ? part : part.slice(0, hash)).trim();
    if (!core) continue;
    const slash = core.indexOf('/');
    if (slash === -1) {
      out.push({ command: core, pkg: null });
    } else {
      out.push({
        command: core.slice(0, slash).trim(),
        pkg: core.slice(slash + 1).trim() || null,
      });
    }
  }
  return out;
}

/**
 * Parse one `.cwl` file.
 *
 * @param text     File contents (UTF-8).
 * @param pkgName  Package name, i.e. filename without `.cwl`.
 */
export function parseCwl(text: string, pkgName: string): CwlPackage {
  const deps: string[] = [];
  const commands: CwlCommand[] = [];
  const environments: CwlEnvironment[] = [];
  const keyvals: CwlKeyvals[] = [];
  let droppedLines = 0;

  // `#keyvals:` blocks list key names, not commands, so their bodies must not
  // be parsed as command lines. Their keys are parsed into `keyvals` instead.
  let inKeyvals = false;
  let keyvalsHeader: { command: string; pkg: string | null }[] = [];
  let keyvalsKeys: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (inKeyvals) {
      if (line.startsWith('#endkeyvals')) {
        for (const entry of keyvalsHeader) {
          keyvals.push({ command: entry.command, pkg: entry.pkg, keys: keyvalsKeys });
        }
        keyvalsHeader = [];
        keyvalsKeys = [];
        inKeyvals = false;
      } else if (line.startsWith('#')) {
        // Other directives inside a keyvals block are data noise; skip.
      } else {
        // An option key, possibly carrying a classification suffix (`key#c`).
        const hash = line.indexOf('#');
        const key = (hash === -1 ? line : line.slice(0, hash)).trim();
        if (key && !keyvalsKeys.includes(key)) keyvalsKeys.push(key);
      }
      continue;
    }

    if (line.startsWith('#')) {
      if (line.startsWith('#include:')) {
        const dep = line.slice('#include:'.length).trim();
        if (dep) deps.push(dep);
      } else if (line.startsWith('#keyvals:')) {
        keyvalsHeader = parseKeyvalsHeader(line.slice('#keyvals:'.length));
        keyvalsKeys = [];
        inKeyvals = true;
      }
      // `#ifOption:`/`#endif` are passed over: the commands they guard are real,
      // just conditional on a package option, and offering them is better than
      // hiding them. `#repl:` (spellcheck) and comments are irrelevant here.
      continue;
    }

    if (!line.startsWith('\\')) {
      // Bare words are data, not commands: `#B` colour names (`abred#B`) and
      // `#keyvals` values reach us this way. They are not parse failures, so
      // they must not inflate droppedLines — that counter is a health signal.
      continue;
    }

    if (FORBIDDEN.test(line)) {
      droppedLines++;
      continue;
    }

    const { body, classifier } = splitClassifier(line);
    const cls = parseClassifier(classifier);
    if (cls.hidden) continue; // `#S` — never show.

    // Environment lines are `\begin{name}` plus optional arguments.
    const envMatch = /^\\begin\{([^{}]+)\}/.exec(body);
    if (envMatch) {
      const envName = envMatch[1];
      const scanned = scanArguments(body.slice(envMatch[0].length));
      if (!scanned) {
        droppedLines++;
        continue;
      }

      environments.push({
        name: envName,
        label: `\\begin{${envName}}`,
        snippet: buildEnvironmentSnippet(envName, scanned.args, scanned.rest, scanned.fields + 1),
        mathOnly: cls.mathOnly,
        unusual: cls.unusual,
        aliases: cls.aliases,
      });
      continue;
    }

    const parsed = parseTemplate(body);
    if (!parsed) {
      droppedLines++;
      continue;
    }

    commands.push({
      name: parsed.name,
      label: `\\${parsed.name}`,
      snippet: `\\${parsed.name}${parsed.argSnippet}${parsed.trailer}`,
      hasFields: parsed.hasFields,
      mathOnly: cls.mathOnly,
      textOnly: cls.textOnly,
      tabularOnly: cls.tabularOnly,
      unusual: cls.unusual,
      envs: cls.envs,
    });
  }

  return { name: pkgName, deps, commands, environments, keyvals, droppedLines };
}
