#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"

cd "$ROOT_DIR"

status_output="$(git status --porcelain)"

printf 'worktree_root=%s\n' "$ROOT_DIR"
printf 'generated_coverage=%s\n' "$(printf '%s\n' "$status_output" | rg -c 'coverage/' || true)"
printf 'maestro_results=%s\n' "$(printf '%s\n' "$status_output" | rg -c 'mobile-app/\\.maestro/results/' || true)"
printf 'tmp_mobile=%s\n' "$(printf '%s\n' "$status_output" | rg -c 'mobile-app/\\.tmp-' || true)"
printf 'mixed_runtime_files=%s\n' "$(printf '%s\n' "$status_output" | rg -c 'register-socket-create-booking-handler\\.js|routes/dashboard\\.js|server\\.vps\\.js' || true)"
printf '\ntracked_modified_preview:\n'
printf '%s\n' "$status_output" | rg '^[ MARCDU?]{2} ' | sed -n '1,120p'
