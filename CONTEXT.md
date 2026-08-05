# Clavis Editing Context

Clavis preserves a user's editing work across files, projects, previews, and application restarts.

## Language

**Document**:
Editable text identified either by a file path or as an unsaved scratch document.
_Avoid_: File, buffer

**Workspace**:
The set of open Documents and the currently active Document.
_Avoid_: Project, session

**Project**:
A related collection of Documents and assets rooted at a primary typesetting Document.
_Avoid_: Workspace, folder

**Session Snapshot**:
A persisted representation of a Workspace used to recover editing work after restart or interruption.
_Avoid_: Cache, backup

**Active Document**:
The Document currently presented for editing.
_Avoid_: Current file, selected tab

**Scratch Document**:
A Document without a file path whose content exists only in the Workspace and Session Snapshot.
_Avoid_: Untitled file, temporary file

**Project Task**:
A named, repository-configured command with arguments, environment, working
directory, timeout, and optional dependencies. It may execute only while its
Workspace root is explicitly trusted.
_Avoid_: Shell command, script

**Task Run**:
One dependency-ordered execution of a requested Project Task, including streamed
output, cancellation, and final status.
_Avoid_: Build, terminal session

**Workspace Trust**:
A user-owned permission, stored outside the Project, allowing Project Tasks at a
canonical Workspace root to execute. A Project cannot grant itself trust.
_Avoid_: Project setting, allowlist flag
