# Santiago realtime host: topology and cutover runbook

Status on 2026-10-16: Santiago is built and running as a **live Redis replica** of
production. Its app services are stopped. DNS still points at Contabo.

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

## Rollback

1. Owner: point DNS back at `62.169.31.231`.
2. On Contabo:
   - Restore the nginx backup and reload it.
   - Promote Contabo's Redis with `REPLICAOF NO ONE`. Skip this if step 7 did not run yet: Contabo's Redis is then still the old primary, but it misses the writes made since the cutover.
   - Start the stopped containers.
3. On Santiago: stop the app services and run `REPLICAOF 10.77.0.2 6379` on its Redis.

## After 24–48 h stable

- Remove the Leaf gateways and workers from Contabo, and delete their images.
- Keep on Contabo: Redis (replica), face compare, the OCR worker, the dashboard, backups and the relays.
- Point the daily backup at the new primary.
