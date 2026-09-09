# Writing refinement · 2026-09-09

Local changes requested by the owner after comparing Clavis with Typora and
Texifier. No version bump, commit, push, tag, release, or change to the release
workflow. The pre-existing documentation edits and staged history moves remain
untouched, except for adding this refinement summary to HANDOFF.

## UI

- Shared titlebar and toolbar: 60 → 48 px, tabs: 40 → 36 px. Action hit targets
  stay at least 32 px; macOS traffic-light clearance remains 76 px. Native
  caption controls and platform-specific shortcuts are unchanged.
- Workspace heading becomes a secondary label, with tighter navigation and
  section spacing. Compile and mode-switch controls use neutral surfaces
  instead of competing accent fills.
- Normal Write and Split use fixed 12 px CodeMirror scroller insets and 24 px
  top content spacing. Only explicit Focus introduces centered 78ch/68ch
  measures and a larger top inset; narrow panes retain compact overrides.
- Paper and Ink use neutral grayscale surfaces, slate command/name colors,
  restrained literal colors, and readable gray comments. Contrast contracts
  pass for backgrounds and active lines. Runtime theme ownership is unchanged;
  pre-hydration fallbacks match the new defaults.
- User font settings, custom colors, community themes, and Mist/Dusk choices
  are preserved. Selection alpha is unchanged: focused 0.7, unfocused 0.5.
  PDF surrounds remain neutral; no new color preferences were added.
- Follow-up owner feedback: theme previews now show only Clavis, with Paper,
  Ink, Mist, or Dusk below. Removed slogan heading, introduction, sample prose,
  code example, and palette descriptions, plus their unused styles/translation
  keys. The section label is simply Theme. No font or palette settings changed.

## Functionality

- Closing an active tab selects its right neighbor, or its left neighbor when
  closing the last tab, rather than jumping to the final unrelated document.
- Problems/log height observes available workspace height on resize, reserving
  180 px for tabs and writing. Temporary clamps do not overwrite the preferred
  height, so widening/tallening restores it. Drag-end reads the current ref,
  including handlers captured before the drag; overshooting bottom stays at
  the minimum height.
- Forward PDF jumps received during loading or hidden Write mode wait for the
  matching bytes to attach. Each request is consumed once; recompilation and
  Write/Read switching do not replay an already-consumed jump. This does not
  implement the separately deferred subfile SyncTeX mapping.
- Late compile failures after switching documents cannot restore an unrelated
  PDF or publish that error in the new document. Successful late completion
  also preserves a matching current-document PDF. Initial snapshot checks do
  not borrow the previous project's dependencies, and failures for the active
  chapter are still reported before its dependency snapshot is available.
- Existing editor undo/selection/scroll caching was inspected but not rewritten.
  Existing stale-preview retention, save-conflict protection, and font controls
  were not replaced. No claim that every mode-switch/native scroll case is fixed.

## Verification

- TypeScript typecheck passed.
- Full frontend suite: 734 tests across 70 files passed (18 more than prior 716).
- Rust: 144 passed, 3 optional tests ignored.
- Python repository guards: 10 passed.
- Production frontend build passed. Existing Vite mixed static/dynamic-import
  chunk warnings remain; no new runtime dependency was added.
- Local build uses `bash build-macos.sh --app-only --skip-install`; build log is
  `target/local-builds/writing-refinement-build.log`. Cargo input backup/restore
  is owned by that script. Candidate retains version 1.5.0 and disables updater
  only in the generated local bundle; production settings and keys are unchanged.

Tests assert logic, React lifecycles, and stylesheet contracts, not measured
native appearance or pixel layout. No Chrome/browser preview or native visual
walk-through was performed. Before release, inspect the candidate on the Air
in light/dark, Write/Split/Read/Focus, and with real multi-file LaTeX. Verify
window controls, selection readability, and reading continuity while scrolling
and compiling. Session-entry validation and subfile forward SyncTeX remain open.

## Theme preview follow-up verification

- Full frontend suite: 736 tests passed, including English/Chinese preview
  content and existing settings save/cancel regressions. Typecheck passed.
- Rust: 144 passed, 3 optional ignored. Python guards: 10 passed.
- Local app-only build passed; codesign verification and ZIP integrity passed.
  Log: `target/local-builds/theme-cleanup-build.log`. Candidate:
  `target/local-builds/Clavis-theme-cleanup-2026-09-09-arm64.zip`.
- Version remains 1.5.0; local updater disabled; no installation, remote
  operation, or native visual validation. Cargo inputs restored unchanged.
