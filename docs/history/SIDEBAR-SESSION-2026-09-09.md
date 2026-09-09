# Folder recovery and sidebar hierarchy

2026-09-09. Local follow-up only; no commit/push/tag/release authorization.

## Behavior

- Session snapshots now include the explicitly opened `folderPath`, independently
  of tabs and the LaTeX main file. Opening/closing only the folder also persists;
  window unload flushes it. Boot waits for document recovery before subscribing
  to writes. Folder-only sessions survive and receive an empty editable tab.
- Restore re-inspects project metadata without prompting for or granting task
  execution trust. A missing folder keeps its identity and shows the scan error;
  recovered document buffers are not discarded.
- Old v1/v2 snapshots without a folder field remain compatible. Do not guess a
  folder from a main file or the recent list: the user must reopen their folder
  once on the new build. Explicit Close folder persists null and does not reopen
  that folder on the next launch.
- Toolbar no longer duplicates Save. Document menu, Cmd/Ctrl+S, unsaved marker,
  disk autosave preference and conflict protection remain unchanged.
- Folder header has no refresh or second open-folder icon. Root is collapsible;
  opening another folder stays in the document menu/command palette. File lists
  refresh on foreground/visibility return; manual Refresh folder remains in the
  command palette. Expanded directories refresh without folding; closed ones
  stay lazy. Request generations reject stale scans.
- Folder children are real nested lists with indentation, guide lines, folder/
  file icons and an active-file marker. Outline is also a nested chapter tree,
  with independent fold and jump controls. Section bodies sit below their
  headings; research/project categories keep their existing separate views.
  Do not reintroduce a visible Workspace heading or underlined text tabs.
- Hide the duplicate flat Included files section when the actual folder tree
  already covers that LaTeX project. It remains available for file-only work.

## Verification

- Full frontend: 820 tests passing, TypeScript check and production bundle pass.
- Rust: 146 passing, 3 optional ignored.
- Tests include folder+dirty-buffer recovery, folder-only/legacy sessions,
  explicit close, unload flush, pending-boot write gate, cross-platform path
  validation, no trust prompt on restore, nested folder/outline rendering,
  expanded-directory refresh, stale scans and retained menu save.
- Local build command: `bash build-macos.sh --app-only --skip-install`.
  Evidence: `target/local-builds/sidebar-session-20260909/`.
- No Chrome or native GUI automation. Native appearance and quit/relaunch
  acceptance remain for the owner; tests are not visual acceptance.
