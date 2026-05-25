#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"

cd "$ROOT_DIR"

status_output="$(git status --porcelain)"

count_matches() {
  local pattern="$1"
  local count
  count="$(printf '%s\n' "$status_output" | rg -c "$pattern" 2>/dev/null || true)"
  if [[ -z "$count" ]]; then
    count="0"
  fi
  printf '%s' "$count"
}

printf 'worktree_root=%s\n' "$ROOT_DIR"
printf 'generated_coverage=%s\n' "$(count_matches 'coverage/')"
printf 'maestro_results=%s\n' "$(count_matches 'mobile-app/\\.maestro/results/')"
printf 'tmp_mobile=%s\n' "$(count_matches 'mobile-app/\\.tmp-')"
printf 'mixed_runtime_files=%s\n' "$(count_matches 'register-socket-create-booking-handler\\.js|routes/dashboard\\.js|server\\.vps\\.js')"
printf 'mixed_legacy_hotspots=%s\n' "$(count_matches 'routes/dashboard\\.js|routes/metrics\\.js|server\\.js|server\\.vps\\.js|routes/account-routes\\.js|routes/geofence-routes\\.js|routes/referral-programs\\.js|services/daily-subscription-service\\.js')"
printf '\ntracked_modified_preview:\n'
printf '%s\n' "$status_output" | rg '^[ MARCDU?]{2} ' | sed -n '1,120p'
