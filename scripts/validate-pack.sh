#!/usr/bin/env bash
# validate-pack.sh — thin wrapper around the canonical validator.
#
# The real, authoritative pack validation lives in scripts/validate-pack.js
# (run via `pnpm run validate-pack`). This shell version previously carried a
# weaker, divergent set of checks; it now delegates so there is one source of
# truth and no footgun when invoked manually.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/validate-pack.js" "$@"
