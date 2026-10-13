# Clavis — Security Model

Clavis opens, previews and **compiles** Markdown / LaTeX / Typst documents.
Compilation runs real external toolchains, and documents may come from
untrusted sources (a `.tex` file someone emailed you), so the trust boundaries
are stated here rather than left to defaults.

## Threat model

- **Untrusted document input.** Opening or compiling a file the user did not
  author must not execute commands, read arbitrary files, or escape the
  intended directory.
- **Trusted user, trusted machine.** The person running Clavis chooses which
  files to open and where to save. We defend against malicious *document
  content*, not a malicious local user.
- **No network server.** Clavis listens on no port in production. The Vite dev
  server exists only during `npm run dev`.

## 1. Webview → Rust (IPC)

The React frontend has no direct filesystem or process capability. The Tauri
allowlist (`tauri.conf.json`) enables only `dialog` and window dragging; the
`fs` allowlist is removed. File access goes through explicit Rust commands
(`read_text_file`, `save_binary_file`, `scan_folder_shallow`,
the version-checked writes in `src/document_io.rs`), so the filesystem surface
is auditable in one place.

Paths come from user-driven dialogs, the folder tree or the recent lists; they
are not yet checked against a shared path policy (see "Known gaps").

Markdown rendering drops raw HTML and active URL schemes: links may be relative,
`http(s)` or `mailto`, and `data:` URLs are accepted only as base64 images
(`sanitizeUrl` in `web/src/render/markdown.ts`). Relative images load through
`asset_preview`, which canonicalizes the path, keeps it inside the document
folder or open workspace, and caps the size at 20 MiB, the paste/drop limit.
Mermaid diagrams render with `securityLevel: 'strict'` (sanitized SVG, no
scripts or click handlers); the library loads only for documents that contain
one.

Images pasted or dropped into a Markdown document are written by
`save_markdown_image` / `place_markdown_image` (`src/markdown_images.rs`): only
png, jpg, gif, webp and svg, at most 20 MiB, into an `assets` folder beside the
document. Files are created with `create_new`, so an existing file is never
replaced (an identical one is reused); a dropped image already inside the
document's folder is linked where it is, not copied.

Cmd/Ctrl+click on a relative link opens other documents in Clavis. Any other
file goes through `open_workspace_file` (`src/system_open.rs`), which hands the
operating system only files inside the workspace whose type it views (images,
PDF, text, office documents, audio and video). Scripts, installers, shortcuts
and files without an extension are refused, since their default handler runs
them: a link in someone else's document must not start a program.

Markdown HTML export (`web/src/files/exportMarkdown.ts`) uses the same
sanitizing renderer, so raw HTML is still dropped. It embeds only images that
`asset_preview` would show and writes through `save_binary_file` to the path
picked in the save dialog.

## 2. Rust → external toolchains

### LaTeX — shell escape disabled

Every compile passes **`-no-shell-escape`** (`src/latex/compile.rs`), regardless
of the TeX distribution's own `shell_escape` setting. This is the main defense
against a `.tex` file achieving code execution. If shell escape is ever exposed
as an option it must default to off, carry an explicit danger prompt, and be
scoped to the session rather than saved.

Also: `-interaction=nonstopmode`, `-halt-on-error`, per-run and total timeouts,
and a temporary workdir that the frontend only knows by an opaque token.

### latexmk full builds — workspace trust

A project `.latexmkrc` is Perl and can run commands, so a full build requires
the user to confirm trust for that folder. Trust is stored outside the project
(`src/project_config.rs`); a project cannot grant it to itself. latexmk runs
with `-norc`, and only a `.latexmkrc` whose canonical path is inside the
workspace is passed with `-r`. `-no-shell-escape` still applies.

### Project file collection — path traversal rejected

`is_safe_relpath` (`src/latex/project.rs`) rejects empty, absolute (including
drive-letter and UNC), `.`, `..`, root and prefix components. Collection is
bounded by `MAX_PROJECT_FILES` (200), `MAX_FILE_BYTES` (5 MiB), `MAX_FONT_BYTES`
(64 MiB) and `MAX_DEPTH` (5).

### TeX package installation — validated and confirmed

`install_package` (`src/latex/distro.rs`) runs `tlmgr` / `miktex` / `mpm` only
after a native confirm dialog naming the package and manager. Package names must
match `[A-Za-z0-9._+-]` (max 80 chars), stdin is null, and only known managers
are dispatched.

### PDF export

`export_latex_pdf` refuses to write into the temporary compilation directory.

## 3. Typst

Typst reads files through `TypstWorld::resolve_in_root` (`src/typst_world.rs`):
project files resolve under the document's project root (`VirtualPath` cannot
express `..`, and the canonical result is re-checked against the canonical root
so symlinks cannot escape); package files resolve only from the local package
cache. Packages are downloaded only after the user confirms in the preview
diagnostics.

## 4. Content Security Policy

`default-src 'self'`; `connect-src` limited to `'self'` and the Tauri IPC
origins; `img-src` / `font-src` limited to `'self'`, `data:` and `blob:`.
Remote images therefore do not load, in the editor or anywhere else.

## Known gaps

- **Path policy.** Read/write commands trust the supplied path. A shared policy
  could confine them to user-authorized roots.
- **CSP.** `script-src` still allows `'unsafe-inline'` because the frontend uses
  `window.__TAURI__`; see the Tauri v2 item in `docs/ROADMAP.md`.
