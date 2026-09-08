#!/usr/bin/env bash
set -euo pipefail
ROOT="$(dirname "$0")"
exec node "$ROOT/tools/build-macos.mjs" "$@"
