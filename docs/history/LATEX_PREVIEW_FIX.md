# LaTeX initial preview fix · 2026-09-08

## Report and confirmed defects

The user supplied a minimal article containing `hello` and reported no visible body in the preview. The source is valid. Local TeX Live pdflatex compiled that exact source to a one-page PDF. Real PDF.js + the already-installed Skia canvas extracted `hello` and painted 183 dark pixels inside its body bounding box, not merely the footer/page number.

Two code defects were found and covered independently; the user's native window was not inspected, so these are not a claim that its exact runtime failure was reproduced:

- The auto-compile startup guard skipped the first **LaTeX** effect, even when the initial app tab was Markdown. Opening the first .tex file or restoring a LaTeX session therefore required another edit/tab change or explicit compile. Removed that unconditional skip; the small `useLatexAutoCompile` hook owns one 300ms debounce, observes identity/language/content, pauses while hidden or disabled, and resumes on reveal.
- The zoom refactor attached a painted canvas only after text extraction and TextLayer rendering succeeded. A slow, rejected or stalled selection layer could withhold a good page. Canvas readiness now controls presentation; optional selection/search text is loaded separately with the same revision/disposal guards. Actual raster errors propagate during preparation and are reported from subsequent paints, instead of being swallowed as console warnings.

PDF worker initialization is now inside the error boundary of the loading operation. The preview exposes a reload action for PDF errors and distinguishes initial compilation, compilation failure and uncompiled state. No change to TeX syntax, engine settings, compiler options, theme, dependencies or release configuration.

## Verification

- TypeScript and all 605 frontend tests pass. Eleven new regressions cover first open/restore, hidden previews, debounce, a stalled/rejected text layer, first/later raster failures, worker initialization errors and recovery without remounting the host.
- All 141 Rust tests pass; three optional tests are ignored.
- The local repro source/PDF, real PDF.js raster image, scripts and build log are in `target/latex-preview-check/`.
- Native WKWebView verification was attempted in an isolated Swift process without Chrome. It timed out with desktop-service/XPC connection errors in this execution session. No native pixel result was obtained. The successful real PDF.js pixel check uses Skia, not WKWebView, and does not validate the complete application UI.
- Local macOS packaging uses the existing build wrapper with Cargo input backup/restore. No remote operation or release is part of this fix.

Native follow-up: open the rebuilt Clavis app, open a .tex file containing the reported example as the first LaTeX tab, and also restore such a session. With auto-compile enabled and preview visible, it should compile without a second edit. If it is still blank, record whether the page counter is `1 / 1`, an uncompiled/compiling message, a TeX error, or a PDF display error before changing anything else.
