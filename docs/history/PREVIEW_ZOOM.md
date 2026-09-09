# Preview zoom update · 2026-09-08

## Changes

PDF zoom no longer rebuilds every page wrapper and waits for detached viewport rasterization at each wheel step. A PDF owns one `PdfPages` instance until its bytes change or the viewer is hidden. It caches page geometry and retains wrappers across zoom. Existing canvas and text layers scale together immediately; after 140 ms without scale changes only nearby pages repaint. New surfaces replace old ones only when ready. Pending render/text tasks are cancelled on a newer scale, eviction, document replacement or disposal.

Wheel deltas are proportional rather than fixed 10% jumps. A shared input binder accumulates deltas and emits at most once per animation frame. Native non-passive listeners prevent webview-wide zoom. WKWebView GestureEvents support trackpad pinch; duplicate ctrl-wheel input is ignored during that gesture. Unmodified scrolling is untouched. PDF toolbar +/- buttons remain explicit 25% steps.

Both PDF and Typst preserve a page-relative point under the pointer (viewport center for toolbar changes), including horizontal position. Positions clamp naturally at document edges. Typst keeps the same fit-width baseline across scales rather than dropping its 960px cap when leaving 100%; it reuses SVG/text nodes and exposes custom pinch percentages. Page lookup uses binary search rather than sequential geometry reads. Browser scroll anchoring is disabled where we restore anchors ourselves.

PDF repaint re-applies search highlights without navigating back to the first match; explicit searches and next/previous still navigate. Virtualized search results track actual page identity. The PDF point/CSS scale conversion in forward and reverse SyncTeX now matches the PDF.js viewport instead of applying an extra 96/72 factor.

No new production dependency, permanent panel, remote operation or release change. The rendering manager replaces the old inline render-all path rather than adding a parallel implementation.

## Verification

Local full suite: 594 frontend tests and TypeScript check pass; 141 Rust tests pass, three optional tests ignored. Added 23 regressions covering frame batching, wheel units, native gesture handling, cancellation/cleanup, pointer anchors, page lifecycle, search after repaint, coordinate conversion and Typst node reuse.

The 300-page renderer test uses DOM/PDF drawing doubles: after initial preparation, 30 scale updates retain all wrappers, issue zero `getPage` or raster calls during the burst, then redraw only two observed nearby pages. The 1000-page anchor test uses at most 12 geometry reads. These are deterministic workload assertions, not native frame-time benchmarks.

Build command (existing local dependencies and writable caches):

```sh
CARGO_HOME=/Users/prince/Clavis/target/writer-safety/cargo-home CARGO_NET_OFFLINE=true npm_config_cache=/Users/prince/Clavis/target/npm-cache node /Users/prince/Clavis/tools/build-macos.mjs --app-only --skip-install
```

Build output: `target/release/bundle/macos/Clavis.app`. Log: `target/preview-zoom/build.log`. Local packaging completed successfully and codesign verification passed. Cargo.toml and Cargo.lock match pre-build SHA-256 checksums. The build wrapper preserves Cargo inputs around local updater-disabled packaging.

## Native acceptance boundary

No Chrome/browser preview was used. Actual WKWebView pinch smoothness, SVG raster cost, text selection and visual alignment still need native use. During a PDF gesture, the prior bitmap may briefly soften until the settled scale is painted. Each bitmap is capped near 16 megapixels / 8192 pixels per dimension to bound Retina high-zoom allocation; extreme scales may trade detail for memory. PDF search remains scoped to mounted text layers, not a new whole-document search implementation.

Suggested native check: open a long LaTeX PDF and Typst document, pinch around a paragraph in both directions, try Cmd/Ctrl-wheel, test high zoom and horizontal scrolling, keep a search result active while zooming, and hide/switch documents during input. The paragraph should remain near the pointer subject to scroll boundaries, ordinary scrolling should remain unchanged, and stale render tasks must not replace the new document.
