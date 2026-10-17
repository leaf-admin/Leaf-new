#!/usr/bin/env bash
# Renew the sandbox QA online trust window for the next 24 h, without editing
# .env or recreating gateways. Writes the deadline to Redis
# (kyc:qa_online_trust_window:until), which driver-identity-trust-service
# reads on each check. The window still has to be enabled in .env
# (KYC_QA_ONLINE_TRUST_WINDOW_ENABLED, UIDS, PROFILE_ID, ACK, REASON), only
# covers the listed QA UIDs on the sandbox profile, and never exceeds 24 h.
# Run at the start of a device QA session (qa-tools DEVICE_PLAYBOOK.md).
set -euo pipefail

SANTIAGO_SSH="${SANTIAGO_SSH:-leaf-scl-test}"
HOURS="${1:-23}"
case "$HOURS" in ''|*[!0-9]*) echo "usage: $0 [hours<=23]" >&2; exit 2;; esac
[ "$HOURS" -ge 1 ] && [ "$HOURS" -le 23 ] || { echo "hours must be 1-23" >&2; exit 2; }

until_iso="$(date -u -v+"${HOURS}"H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "+${HOURS} hours" +%Y-%m-%dT%H:%M:%SZ)"
ttl=$(( HOURS * 3600 ))

ssh "$SANTIAGO_SSH" "set -e
  grep -q '^KYC_QA_ONLINE_TRUST_WINDOW_ENABLED=true' /opt/leaf-app/.env || { echo '[qa-window] not enabled in .env' >&2; exit 1; }
  docker exec leaf-redis sh -c 'export REDISCLI_AUTH=\"\$REDIS_PASSWORD\"; redis-cli SET kyc:qa_online_trust_window:until $until_iso EX $ttl' >/dev/null
  docker exec leaf-redis sh -c 'export REDISCLI_AUTH=\"\$REDIS_PASSWORD\"; redis-cli GET kyc:qa_online_trust_window:until'"
echo "[qa-window] renewed until $until_iso"
