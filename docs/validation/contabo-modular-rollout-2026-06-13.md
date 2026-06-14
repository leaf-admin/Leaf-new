# Contabo modular rollout — 2026-06-13

## Objective

Replace the destructive compatibility deploy with a modular rolling deployment,
make `docker-compose.production.yml` the real canonical base, and remove active
workspace references to infrastructure providers that are no longer used.

## Scope

- Canonical compose:
  - `docker-compose.production.yml`
  - `docker-compose.gateway-scale.yml`
  - `docker-compose.ops-workers.yml`
- Canonical deploy:
  - `leaf-websocket-backend/scripts/deploy-contabo-docker.sh`
  - `scripts/deploy-contabo-completo.sh`
- Rolling replacement:
  - `websocket-gateway-2`
  - `websocket-gateway-3`
  - `websocket`
  - queue, side effects, billing, pricing baseline and ride health workers
- Redis, named volumes, `.env`, Firebase credentials, SSL, logs and backups were
  preserved.

## Guardrails

- Explicit `CONFIRM_PRODUCTION_DEPLOY=true`.
- No `docker compose down`.
- No volume removal.
- Backup before source synchronization.
- Compose validation on the target host.
- Gateway and worker health required before advancing.
- Public API/socket smoke after rollout.
- Source synchronization protects secrets and uses delayed deletion for stale
  code only.

## Evidence

- Backup:
  - `/opt/leaf-app/backups/modular-rollout-20260613-130857`
- Redis uptime after rollout:
  - 6 days, confirming no restart.
- All managed containers:
  - healthy.
- Redis adapter:
  - active on all three realtime gateways.
- Public health:
  - `https://api.leaf.app.br/health`: healthy.
  - API and socket liveness: HTTP 200.
- Runtime config:
  - production.
  - maps backend-only.
  - Places cache enabled.
  - Routes cache TTL 90 seconds.
  - traffic-aware routes enabled.
  - H3 visual policy version 3.
- No-paid-API benchmark:
  - HTTP: 40/40 success, p95 856 ms.
  - Socket: 24/24 success, p95 1676 ms.
- Active local and remote provider-name scan:
  - no matches outside historical Git data/backups.

## Tests

- Backend focused suites: 23 passed.
- Mobile focused suites: 25 passed.
- Mobile production guards: passed.
- Runtime config validation: passed, with known non-blocking local warnings.
- Runtime legacy guard: passed.
- Governance check: passed.
- Secret scan: passed.
- Hardcoded secret guard: passed.
- `git diff --check`: passed.

## Known warnings

- AWS liveness role credentials are not provisioned in the current production
  environment. Compose reports blank optional variables.
- Biometric strict mode remains disabled by policy.
- These warnings predate this rollout and were not changed here.

## Rollback

Restore the compose files and `source-before.tar.gz` from the backup directory,
then replace gateways one at a time in the same order. Redis and its volume do
not need to be restored.
