# CI runner disconnect investigation (2026-09-08)

## Observed failure

Both v1.3.0 runs target cbf3ae99edd545f3c85d334e66b4ed9f9ac4b808:

- [main CI](https://github.com/ziwangprincex/Clavis/actions/runs/34211021508), job 102011782146.
- [Release](https://github.com/ziwangprincex/Clavis/actions/runs/34211022115), verify job 102011785974.

Frontend typecheck/tests/build and Rust all-target check succeeded. Both runs lost their hosted runner during the Rust tests step. The check annotation is: "The hosted runner lost communication with the server. Anything in your workflow that terminates the runner process, starves it for CPU/Memory, or blocks its network access can cause this error."

Job logs return 404 and the available run log archive is empty. There is no captured failing assertion or OOM record. Do not report the failure as a proven memory shortage. The Release draft and matrix jobs were skipped; the latest published version remains v1.2.0. Marker-inspired UI changes are uncommitted and were not part of either failed run.

## Concrete cancellation bug

Two Unix cancellation paths invoked external `kill` as `kill -KILL -<pgid>` or `kill -TERM -<pgid>`. Each child already has its own process group. The missing `--` is the problem, not process-group creation.

Ubuntu 22.04's procps 3.3.17 implementation removes the signal argument, passes the negative operand to getopt, then uses `atoi(argv[optind-1])` in the unknown-digit option branch. While getopt is still inside a multi-digit option, this can select argv[0] (the program name) instead of the negative group. `atoi("kill")` is zero: `kill(0, signal)` targets the caller's group, potentially including the test harness and runner. The new v1.3.0 engine-cancellation test executes this path; the older task path has the same defect.

A local parsing-only C probe, reproducing these exact argv/getopt/atoi operations, printed target 0 for `-KILL -12345` and -12345 for `-KILL -- -12345`. It never calls kill or sends a signal. This was run on macOS, not a Linux VM. The procps source and probe are archived under ignored `target/marker-study/`.

This is a concrete bug and a strong explanation for the lost runner, but unavailable failed-run logs prevent proving which process was signalled on GitHub. A fresh Linux CI run remains required.

## Fix and checks

Both `src/latex/engine.rs` and `src/tasks.rs` now use `kill -SIGNAL -- -<pgid>`. No new runtime dependency, unsafe syscall, broad process matching or speculative cancellation layer.

`tools/test_process_signals.py` statically checks both argument lists before CI reaches Rust tests. It rejects missing/misplaced separators and targets 0/-1. The native cancellation regression verifies descendant pipe closure, reaping, repeated cancellation and survival of another process group. It creates only disposable sleep/sh processes.

CI separates `cargo test --locked --no-run` from execution so future failures identify compilation versus running tests. Execution uses `cargo test --locked -- --test-threads=1 --nocapture` with a 15-minute step limit; every default test still runs, and tests that exercise concurrency internally remain concurrent. Release still requires the reusable CI gate; no continue-on-error, skipped cancellation test or relaxed release check.

Local verification: 645 frontend tests, 142 Rust tests (three existing optional tests ignored), ten Python guard tests, typecheck and all-target Rust check passed. Production application packaging status is recorded in HANDOFF. Native visual acceptance and GitHub Linux execution are not claimed passed.

## Remote boundary

No commit, push, tag movement, rerun or publication is performed by this repair. Rerunning v1.3.0 as-is would use the same defective source; pushing main alone cannot update its immutable tag. Do not force-move v1.3.0. After approval, push the repair and use a fresh version/tag for any release containing it; review whether the still-local Marker design is included. Keep updater features/public key unchanged. The five old untracked one-off tools are not release inputs.

## Sources

- [procps v3.3.17 skill.c](https://github.com/warmchang/procps/blob/v3.3.17/skill.c), `skill_sig_option` and `kill_main`.
- [Linux kill manual](https://linuxman7.org/linux/man-pages/man1/kill.1.html), negative process-group operands and the `--` separator.
