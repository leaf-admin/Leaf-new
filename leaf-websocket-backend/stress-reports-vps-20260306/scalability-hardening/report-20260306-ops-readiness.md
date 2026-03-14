# Ops Readiness Report (Soft Release)

Date: 2026-03-06
Target VPS: 147.182.204.181

## Executed items

1. Production env freeze
- Updated `/opt/leaf-websocket-backend/.env` with runtime tuning keys:
  - `SOCKET_ALLOW_POLLING=false`
  - `ALLOW_MULTIPLE_SESSIONS=false`
  - `SOCKET_ADMISSION_*`
  - `AUTH_VERIFY_*`
  - `ENABLE_QUEUE_BACKPRESSURE=true`
  - `QUEUE_*`
  - `PAYMENT_HOLDING_TIMEOUT_MS=2500`
  - `OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:3001/otel`

2. PM2 persistence / boot
- `pm2 save` applied.
- `pm2-root` is `enabled` and `active` in systemd.
- Backend restarted with `--update-env` and process list saved again.

3. Log rotation
- `pm2-logrotate` installed and running.
- Config:
  - `max_size=50M`
  - `retain=10`
  - `compress=true`
  - `rotateInterval=0 0 * * *`

4. Daily backups (Redis + Firestore critical)
- Added scripts:
  - `scripts/ops/backup-daily.sh`
  - `scripts/ops/backup-firestore-critical.js`
- Added cron entry:
  - `/etc/cron.d/leaf-backup`
  - schedule: `03:10` daily
  - logs: `/var/log/leaf-backup.log`
- Manual backup test passed.
  - Redis backup file generated (`.rdb.gz`)
  - Firestore critical backup generated (`.json.gz`)

5. Smoke test after restart
- Health endpoint: app components healthy (Redis/Firebase/WebSocket healthy).
- OTEL endpoint healthy and ingesting.
- E2E smoke 50 rides:
  - file: `stress-test-e2e-rides-1772813040230.json`
  - successRate: `100%`
  - failed: `0`

## Notes
- `/health` may show `degraded` due to system CPU policy threshold from load average conversion while service checks are healthy.
- Webhook payment endpoint was intentionally not changed (per request).
