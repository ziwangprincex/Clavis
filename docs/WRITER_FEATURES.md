# Writer features · local candidate · 2026-09-08

This completes the remaining areas of the approved pure-writer roadmap, on top of the previous save protection, themes and typesetting work. It is a local candidate, not a new release.

## Entrypoints

Open **Document tools** at the top right:

- **Formulas in text** enables inline formula rendering. The cursor/selection line remains source. Click a formula to edit. The preference persists; default is off.
- **New from template…** creates a new named folder under a parent you choose, then opens the main document. Existing directories are never replaced. Choose Typst paper, LaTeX paper or Markdown research note.
- **Check environment…** reports bundled renderers and local TeX/bibliography engines. It works without a workspace. It never installs anything.
- **Local version timeline…** lists versions for the active saved file. Choose a version to read it, compare with the current draft, restore into the editor or open a scratch copy. Create checkpoint captures the current buffer even before saving it to its document path.

Typst Read/Split preview now includes page input, previous/next, Fit width/zoom, whole-document Find and match navigation. Select text directly on a rendered page and copy normally. Internal reference links navigate inside the preview. Source navigation remains available on double-clicking non-selected page space; source-to-preview uses the existing Document tools entry.

Compiler diagnostics retain their original message. Explanations distinguish missing files/packages, fonts/engines, undefined symbols, missing delimiters, layout warnings and bibliography reruns. LaTeX messages expose the matching source/settings/environment/full-build action; Typst exposes source locations, environment checks and the existing confirmed package download.

## Performance changes

- Preview revisions compare project/dependency content references, not JSON serialization of every open tab on each render. Snapshots include only the current project's documents, retaining dirty buffers for dynamically discovered imports. Dependency paths come from the actual Typst world reads.
- Dependencies, including closed included files and assets, are metadata-polled while the preview is visible. Changed dependencies trigger preview refresh; the save-protection monitor continues to own open-buffer reconciliation.
- Prose spelling maintains multiline state per line. Local edits scan from the affected line until syntax state stabilizes. Existing decorations map through edits; ordinary 30,000-line one-line edits scan one line instead of the document. The index still copies an array of line references; this is not a custom rope implementation.
- Typst reuses its main `Source` via incremental replace. A separate world serves formula renders, with a try-lock to avoid queued native formula work. Inline jobs that are no longer visible are dropped before rendering; formula HTML cache is bounded to 128 entries.
- Source positioning uses one point per shaped text run rather than one per glyph. Navigation remains line-based, with much smaller payloads.
- SVG pages use a bounded 32 MiB cache. The frontend acknowledges SVG hashes it actually holds; the backend omits matching SVG strings on the next response. Text/links/source points are still refreshed, so equal visuals do not imply stale source positions. No generic delta/patch engine was introduced.
- Only visible/nearby page SVG and text DOM remain mounted. Lightweight page slots preserve scrolling geometry. Full text stays available to search even when pages are unmounted.

### Actual timing

Same explicit-page Typst corpus, same local machine, Rust **debug/test build**, first render followed by a small first-page edit. These are one-run observations, not a GUI frame-rate benchmark. First-process font discovery contributes to the 20-page cold timing. PDF export and IPC JSON parse time are not included in the elapsed compile figures.

| Pages | Before cold | After cold | Before edit | After edit | Before full payload | After full payload |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 10,497 ms | 9,746 ms | 938 ms | 56 ms | 7,004,700 B | 4,178,521 B |
| 100 | 6,726 ms | 2,020 ms | 6,619 ms | 169 ms | 35,160,930 B | 20,889,226 B |
| 300 | 35,100 ms | 6,147 ms | 35,180 ms | 5,809 ms | 105,659,630 B | 62,667,176 B |

These full-payload measurements precede SVG omission. A separate real two-page identical-preview protocol test measured 29,990 B first response versus 1,093 B repeated response, retaining fresh text and source mapping. The 300-page case exceeds the bounded SVG cache and still has substantial cold output; there is no claim that arbitrary long documents are instantaneous.

Reproduce from repository root:

```sh
CARGO_HOME=/Users/prince/Clavis/target/writer-safety/cargo-home cargo test --offline writer_benchmarks -- --ignored --nocapture
CARGO_HOME=/Users/prince/Clavis/target/writer-safety/cargo-home cargo test --offline incremental_page_tests -- --nocapture
CARGO_HOME=/Users/prince/Clavis/target/writer-safety/cargo-home cargo test --offline real_latex_test -- --ignored --nocapture
```

## History semantics

History lives in the application's settings directory under `clavis/history`, separate from source files and Git. Changed saves checkpoint the previous disk contents before replacement, then recheck the disk revision. History failure does not discard or block a valid document save: a visible status warning reports that history could not be written. Manual checkpoints and pre-restore checkpoints report failures and abort restoration.

Restoring changes the editor buffer only and leaves its disk revision baseline intact; the existing save conflict protocol remains in charge of the next save. Current writing is checkpointed first and also retained as a scratch recovery copy. Identical consecutive versions deduplicate. Retention removes oldest snapshots beyond 50 per document or 256 MiB across all documents, with a 32 MiB per-version limit.

History is keyed to the document path, not a rename-tracking database. It is bounded local recovery, not backup or a replacement for external copies. Normal automatic versions represent the previous disk state; use Create checkpoint for an immediate snapshot of the newest buffer. The diff highlight shows the first 12,000 characters only; the historical textarea is complete.

## Inline math and reading limits

Inline rendering deliberately supports single-line `$...$`, `$$...$$`, `\(...\)` and `\[...\]` recognized by the existing math parser, excluding cursor/selection lines and indexed code blocks. Multiline display environments remain editable source. KaTeX does not inherit arbitrary document macros; Typst snippets do not inherit project definitions. Failure leaves source visible. These are presentation decorations: document text and undo history are not rewritten.

The Typst text layer follows shaped runs and transforms but uses browser text metrics scaled to run widths. Complex scripts, ligatures, rotation and multi-column selection order need native visual acceptance. Whole-document literal search crosses text fragments and typeset line breaks on a page; phrases split across page boundaries are not matched. Offscreen pages are unmounted, so drag-selection across hundreds of pages is not the intended copy workflow. Internal reference destinations are supported; external web-link activation is not added here.

## Code structure and verification

Native responsibilities are isolated: `local_history.rs` owns retention, `templates.rs` owns starter files, `typst_preview.rs` owns reading/source output and SVG cache, `typst_service.rs` owns worker separation. UI tools share one modal shell. Guidance, reading text, revision selection and prose indexing are pure testable modules. No new production dependencies, plugin system or general-purpose framework was introduced.

565 frontend tests pass, including new incremental prose, project isolation, cross-run/full-document search, formula, template, history restoration and SVG acknowledgement tests. Targeted native disk/history/template/formula/protocol tests pass. The Typst starter compiles offline; the LaTeX starter was separately compiled with real local pdflatex. Full build/test and signing results are appended below after packaging.

No Chrome/browser preview, remote Git operation, version bump or publication. Native appearance, selection alignment and keyboard feel have not been manually accepted.

## Final local packaging verification

Full local build completed successfully: 565 frontend tests, 141 Rust tests, typecheck, production frontend bundle and macOS application bundle. Three optional tool/benchmark tests are ignored in the default Rust suite; the new long-document benchmark and real pdflatex starter were run explicitly as described above. `codesign --verify --deep --strict` passes. Cargo.toml and Cargo.lock match their pre-packaging backups byte-for-byte. App is ad-hoc signed, not Apple-notarized. No publication or developer-credential operation.

Application: `target/release/bundle/macos/Clavis.app`. Download archives: `target/writer-complete/Clavis-writer-macos.zip` and `target/writer-complete/Clavis-writer-source.zip`.
