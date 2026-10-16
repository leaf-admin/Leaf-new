# Santiago realtime host: topology and cutover runbook

Status: **cutover done on 2026-10-16 02:41 UTC.**
- Santiago is the primary. `api` and `socket.leaf.app.br` point at 64.176.9.163.
- Contabo's `leaf-redis` replicates from Santiago, and Contabo nginx forwards Leaf stragglers over the tunnel.
- The Leaf gateways and workers on Contabo are stopped and kept for rollback.
- TLS is split. `api` and `socket` renew on Santiago (`/etc/cron.d/leaf-certbot-renew`), and `dashboard` renews on Contabo.

## Deploying (since the cutover)

Run from the clean `main` checkout:

```bash
cd leaf-websocket-backend
CONFIRM_PRODUCTION_DEPLOY=true PRODUCTION_RELEASE_SHA=$(git rev-parse HEAD) \
  DEPLOY_TRACKED_PATHS="..." bash scripts/deploy-santiago-docker.sh
```

- The wrapper targets 64.176.9.163, two gateways and the `docker-compose.santiago.yml` overlay.
- Santiago's `.env` sets `LEAF_SANTIAGO_PRIMARY=true` and `COMPOSE_PROFILES=primary`. Any manual compose command there runs the full primary set, as long as it uses the same `-f` list as the script: `docker-compose.yml`, `docker-compose.gateway-scale.yml`, `docker-compose.ops-workers.yml` and `docker-compose.santiago.yml`.
- `deploy-contabo-docker.sh` must not be pointed at Contabo any more.
- A full deploy of `main` (without `DEPLOY_TRACKED_PATHS`) is blocked until the KYC biometric policy in `main` matches the production `.env`.

## Topology

| Host | Address | Role |
|---|---|---|
| Santiago (Vultr `voc-c-4c-8gb-75s`, `leaf-scl-test-1`) | 64.176.9.163, WireGuard 10.77.0.1 | Realtime: nginx, 2 gateways, Redis primary, queue/sideeffects/trip-location workers; billing, pricing-baseline and ride-health-monitor run with `--profile primary` |
| Contabo (shared VPS, France) | 62.169.31.231, WireGuard 10.77.0.2 | Support: face compare, OCR worker, Redis replica, dashboard, backups, other projects |

- WireGuard: `wg0` on Santiago (listens on 51820/udp, only from Contabo), `wg-leaf` on Contabo. Docker starts after WireGuard on both hosts (`/etc/systemd/system/docker.service.d/10-after-wireguard.conf`).
- Contabo serves Santiago only over the tunnel:
  - `leaf-wg-relay-face`: `10.77.0.2:8008`, the face compare service.
  - `leaf-wg-relay-redis`: `10.77.0.2:6379`, the Contabo Redis.
  - `leaf-ocr-worker`: `10.77.0.2:3110`.
- Santiago nginx routes `/api/ocr/` to the OCR worker over the tunnel. If the worker is down, the gateways are the backup.
- Santiago runs the **exact code tree deployed on Contabo**, copied over the tunnel, not `main`. `main` carries a stricter KYC biometric policy that production has not received yet, and that policy blocks boot with the current `.env`.

Compose on Santiago (`/opt/leaf-app`):

```bash
C="docker compose -p leaf-app -f docker-compose.production.yml -f docker-compose.gateway-scale.yml \
  -f docker-compose.ops-workers.yml -f docker-compose.santiago.yml"
```

`LEAF_SANTIAGO_PRIMARY` controls the gateway jobs that must run in only one place: the daily earnings report and the ride finalization outbox.

## Rules

- Never run Santiago workers against a copy of production Redis while Contabo workers are also running. Stream consumer groups would hand the same events to both.
  - The 2026-10-16 drill was safe only because every group had `pending=0 lag=0` and `bookings:active` was empty.
  - In a drill, check that first or start only the gateways.
- Santiago nginx resolves the gateway names at start. Start the gateways first, then (re)start or reload nginx.
- `/opt/leaf-app/firebase-credentials.json` must be `0440 root:1001`. The containers run as uid 1001.

## Before the cutover

1. **Owner.** Lower the TTL of `api`, `socket` and `dashboard.leaf.app.br` to 60 s in Cloudflare, one day ahead. `dashboard` keeps pointing at Contabo.
2. Check that Santiago's Redis is a healthy replica: `master_link_status:up` and offsets equal (`INFO replication`).
3. Check that the production streams are drained. Run the stream check from the session scratch `streams.sh`: every group should show `pending=0`.

## Cutover (low-traffic window, about 2–5 minutes of reconnects)

On Contabo (`/opt/leaf-app`):

```bash
# 1. Stop Leaf realtime services (gateways and workers). Keep redis, nginx, dashboard,
#    face compare, OCR worker and the relays.
docker stop leaf-websocket leaf-websocket-gateway-2 leaf-websocket-gateway-3 leaf-websocket-gateway-4 \
  leaf-queue-worker leaf-sideeffects-worker leaf-billing-worker leaf-trip-location-worker \
  leaf-pricing-baseline-worker leaf-ride-health-monitor-worker
```

On Santiago (`/opt/leaf-app`):

```bash
# 2. Wait for the replica to catch up (offsets equal), then promote.
docker exec leaf-redis sh -c 'REDISCLI_AUTH=$REDIS_PASSWORD redis-cli INFO replication' | grep -E 'offset|link'
docker exec leaf-redis sh -c 'REDISCLI_AUTH=$REDIS_PASSWORD redis-cli REPLICAOF NO ONE'

# 3. Start everything as primary (drill: services healthy about 7 s after promotion).
export LEAF_SANTIAGO_PRIMARY=true
$C --profile primary up -d
docker restart leaf-nginx
curl -s --resolve api.leaf.app.br:443:127.0.0.1 -k https://api.leaf.app.br/health
```

On Contabo:

```bash
# 4. Forward stragglers (old DNS) to Santiago over the tunnel. Only the Leaf
#    upstream changes; the lensury/trip42 blocks stay as they are.
cp nginx.multi-gateway.conf nginx.multi-gateway.conf.backup-pre-santiago-$(date -u +%Y%m%dT%H%M%SZ)
cp nginx.multi-gateway.forward-to-santiago.conf nginx.multi-gateway.conf
docker exec leaf-nginx nginx -t && docker exec leaf-nginx nginx -s reload

# 5. The OCR worker keeps its circuit-breaker state on the new primary.
OCR_WORKER_REDIS_HOST=10.77.0.1 OCR_WORKER_BIND=10.77.0.2 docker compose -p leaf-app \
  -f docker-compose.production.yml -f docker-compose.gateway-scale.yml -f docker-compose.ops-workers.yml \
  -f docker-compose.ocr-worker.yml up -d --no-deps ocr-worker
```

6. **Owner.** In Cloudflare, point `api` and `socket.leaf.app.br` to `64.176.9.163`.
7. Make Contabo's Redis a replica of Santiago. Santiago Redis must first be reachable on `10.77.0.1:6379` through a relay like the ones on Contabo. Then run `REPLICAOF 10.77.0.1 6379` on Contabo's `leaf-redis`, with `masterauth` set.
8. Watch for 30 minutes:
   - `capacity-snapshot`, run on Santiago.
   - Sentry.
   - The uptime monitor.
   - Contabo nginx access logs, which should taper off as DNS expires.

## Failover to Contabo (Santiago lost) and failback

Contabo keeps a **cold standby**: the gateway and worker images are prebuilt,
but no containers run, and the nginx variants sit next to the live config:
- `nginx.multi-gateway.local-gateways.conf`: Contabo serves Leaf itself.
- `nginx.multi-gateway.forward-to-santiago.conf.health`: the normal mode, forwarding to Santiago.

Drill on 2026-10-16, run with DNS untouched and verified through `curl --resolve` against Contabo:

| Step | Script | Time |
|---|---|---|
| Fail over: stop Santiago app, promote the Contabo Redis, start 4 gateways + 6 workers, point nginx at the local gateways | `scripts/ops/failover/failover-to-contabo.sh` | **32 s** to HTTPS 200 and WebSocket 101 on Contabo |
| Fail back: stop the Contabo app, resync Santiago Redis from Contabo and promote it, start Santiago, forward again, make Contabo the replica | `scripts/ops/failover/failback-to-santiago.sh` | **31 s** to HTTPS 200 on Santiago |

During a real incident, add the DNS step:
- **Owner:** point `api` and `socket` at `62.169.31.231`, then back to `64.176.9.163` for failback. The TTL is 300 s.
- **Until DNS moves:** clients keep resolving Santiago, so a full Santiago outage is still visible to them for up to the TTL.
- **If Santiago is unreachable:** skip its stop step. Contabo's Redis keeps only what had replicated, which is seconds behind.

**Keep the standby current.** After each backend deploy to Santiago, refresh the Contabo images:
- Stream the code tree over the tunnel, excluding `.env*`, credentials, `certbot`, `ssl`, `docker-compose*.yml` and `nginx*.conf`.
- Run `docker compose ... build` for the gateway and worker services. Never `up`.

Otherwise a failover runs the previous release.

## Housekeeping

- Remove the Leaf gateways and workers from Contabo, and delete their images.
- Keep on Contabo: Redis (replica), face compare, the OCR worker, the dashboard, backups and the relays.
- Point the daily backup at the new primary.
