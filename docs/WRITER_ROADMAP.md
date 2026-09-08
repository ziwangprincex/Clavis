# Pure writer roadmap

Updated 2026-09-08. Clavis is a quiet, reliable writing tool, not a small IDE. No plugin marketplace, built-in terminal or large AI sidebar. The owner authorized all six areas and asked for simple, maintainable code rather than layers of speculative defensive logic.

## Implemented in the local writer candidate

1. **Save conflict protection**: version-checked manual/automatic/Save As operations, external-change reconciliation and explicit comparison/merge. See `SAVE_PROTECTION.md`.
2. **Long-document performance**: project/dependency-scoped preview revisions without serializing all tabs on every render; incremental prose marking; independent discardable formula rendering; incremental Typst main-source parsing; bounded SVG cache; line/run-level source mapping; client-acknowledged unchanged SVG omission; offscreen page DOM unloading. Actual 20/100/300-page debug-build measurements are in `WRITER_FEATURES.md`.
3. **Typst reading**: selectable text layer, case-insensitive literal search across the whole document including unmounted pages and adjacent text runs, match navigation, page number input, zoom, internal reference links, existing bidirectional source positioning. SVG remains the visual source of truth.
4. **Diagnostic guidance**: shared explanation/action rules, source jump, engine settings, environment inspection and LaTeX full-build entrypoints. Original messages remain visible; Typst package downloads retain confirmation.
5. **In-document formulas**: opt-in replacement of supported single-line formulas outside the cursor/selection line; click to reveal editable source. Markdown/LaTeX use KaTeX; Typst uses a separate native renderer. Unrenderable formulas stay as source, not error widgets. Multiline display environments and document-local macros/definitions are not rendered in place.
6. **Templates and local version timeline**: offline Typst paper, LaTeX paper and Markdown research note; no scripts or downloads. Previous disk versions are captured on changed saves; manual checkpoints, comparison, restore-to-buffer and open-as-copy. History is independent of Git, bounded to 50 versions/document and 256 MiB globally.

## Delivery boundaries

Work remains local in `/Users/prince/Clavis`. Existing themes and LaTeX/Typst workflow are retained. No MCP/Gongfeng, Chrome preview, automatic commit/push, release or developer-credential changes. Current version/release metadata is unchanged.

All roadmap areas now have usable implementations. This does not assert arbitrary 300-page documents compile instantly, perfect text selection for every rotated/complex script, full-document macro expansion inside inline widgets, or production-grade backup semantics. Native visual and interaction acceptance remains a separate user check. See `WRITER_FEATURES.md` for reproducible tests, measurements and exact limits.
