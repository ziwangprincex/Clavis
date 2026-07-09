# Clavis — Security Model

This document describes the trust boundaries and defensive measures in Clavis,
a desktop editor that opens, previews, and **compiles** Markdown / LaTeX / Typst
documents. Compilation runs real external toolchains, and documents may come
from untrusted sources (e.g. a `.tex` file someone emailed you), so the security
model is stated explicitly rather than left to defaults.

## Threat model

- **Untrusted document input.** A user may open a `.tex` / `.typ` / `.md` file
  they did not author. Opening or compiling such a file must not allow it to
  execute arbitrary commands, read arbitrary files, or escape the intended
  working directory.
- **Trusted user, trusted machine.** The person running Clavis is trusted to
  choose which files to open and where to save. We do not defend against a
  malicious *local user*; we defend against malicious *document content*.
- **No network server.** Clavis is a local desktop app. It does not listen on a
  network port in production. (The Vite dev server exists only during
  `npm run dev` and is never shipped.)

## Trust boundaries

### 1. Webview → Rust (IPC)

The React frontend runs in a webview and has **no direct filesystem or process
capability**. The Tauri allowlist (`tauri.conf.json`) enables only:

- `dialog` (open / save / message / ask / confirm) — user-driven pickers.
- `window.startDragging` — custom title bar.

The `fs` allowlist is **removed entirely** (no `scope: ["**"]`). All file
reads and writes go through explicit Rust commands (`read_text_file`,
`write_text_file`, `path_exists`, `save_binary_file`, `scan_folder*`), and the
corresponding `fs-*` Cargo features are removed from `tauri.toml` so the
capability isn't compiled in. This means the entire filesystem surface is
auditable in one place (Rust) rather than exposed as a broad JS API.

Paths handled by these commands originate from user-driven open/save dialogs or
the recent-files list. A future hardening step is to add a shared path policy
that validates every path against an allowed set (see "Known gaps").

### 2. Rust → external toolchains (LaTeX / Typst / package managers)

#### LaTeX compilation — shell escape disabled

LaTeX engines can execute shell commands via `\write18`. Clavis passes
**`-no-shell-escape`** explicitly on every compile (`src/latex.rs`) so this is
**off regardless of the user's TeX distribution configuration** (which might set
`shell_escape = t` globally). This is the single most important defense against
a malicious `.tex` file achieving code execution.

If shell-escape is ever exposed as a user option, it MUST:
- default to off,
- carry an explicit danger prompt,
- ideally be scoped to the current workspace/session rather than saved as a
  persistent default.

Other compile hardening:
- `-interaction=nonstopmode` and `-halt-on-error` — no interactive prompts.
- Per-run and total compile **timeouts** to bound runaway compiles.
- Compilation happens in a temporary **workdir**; the frontend only ever holds
  an opaque **workdir token**, never the real temp path.

#### Project file collection — path traversal rejected

When collecting a LaTeX project's files, every relative path is checked by
`is_safe_relpath` (`src/latex.rs`), which rejects:
- empty paths,
- absolute paths (incl. Windows drive-letter and UNC paths),
- any `..`, `.`, root, or prefix component.

Collection is additionally bounded by `MAX_PROJECT_FILES` (200),
`MAX_FILE_BYTES` (5 MiB), and `MAX_DEPTH` (5).

#### TeX package installation — validated + user-confirmed

`install_package` (`src/latex.rs`) runs `tlmgr` / `miktex` / `mpm`. Defenses:
- **Package name whitelist**: must match `[A-Za-z0-9._+-]`, max 80 chars —
  blocks argument/command injection via the package name.
- **Explicit user confirmation** (`src/App.tsx`): a native confirm dialog names
  the exact package and manager and warns that an external command will run.
  Nothing is installed without the user clicking through.
- The command is logged to the compile log before execution.
- `stdin` is null; only known managers are dispatched.

#### PDF export path policy

`export_latex_pdf` refuses to write into the temporary compilation directory,
preventing an export from clobbering intermediate build state. Exports go to a
user-chosen destination.

### 3. Content Security Policy

The webview CSP (`tauri.conf.json`) restricts `default-src` to `'self'`,
limits `connect-src` to `'self'` and the Tauri IPC origins, and scopes
`img-src` / `font-src` to `'self'`, `data:`, and `blob:`. There is no
`connect-src` to arbitrary remote origins.

## Typst

Typst compilation uses an **in-memory `World`** (`src/typst_world.rs`) whose
`file()` implementation returns `NotFound` for everything. As a *security*
property this is conservative: a Typst document currently **cannot read any file
from disk** — no `#image("...")`, no `#include`, no local data files. This is a
functionality limitation (Typst is a lightweight preview today, not a full
project workflow), but it is also fail-safe: there is no path-traversal surface
in the Typst path because there is no filesystem access at all.

If Typst gains project-file support in the future, it MUST reuse the same
`is_safe_relpath`-style containment used for LaTeX project collection — reads
confined to the document's project root, no absolute paths, no `..` traversal.

## Known gaps / future hardening

- **Path policy.** File read/write commands currently trust the dialog-supplied
  path. A shared `path_policy` module could confine reads/writes to a set of
  user-authorized roots (the open document's directory, recent files, an app
  data dir) and reject anything else — closing the gap left by Tauri v1's lack
  of dynamic per-file scope grants.
- **Typst filesystem support** is intentionally absent; see above for the
  containment requirement if it is added.
- **Migration to Tauri v2** would allow dynamic capability grants (authorize a
  specific file only after the user picks it in a dialog) instead of a static
  allowlist, further shrinking the ambient authority of the app.
