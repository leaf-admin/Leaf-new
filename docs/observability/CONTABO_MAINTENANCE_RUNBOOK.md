# Contabo Maintenance Runbook

This runbook covers the current Leaf production VPS maintenance flow. It is for operating system updates and controlled reboot only; it must not be mixed with backend runtime changes, KYC changes, or container reconciliation.

## Scope

- Capture pre-maintenance evidence.
- Preserve a minimal rollback package on the VPS.
- Apply Ubuntu package updates.
- Reboot only when `/var/run/reboot-required` exists.
- Validate Docker autostart, Redis, Nginx, API, socket and workers after reboot.

## Preflight

Run from the project root:

```bash
git status --short --branch
bash scripts/healthcheck-vps.sh https://api.leaf.app.br
node leaf-websocket-backend/scripts/stress-test/no-paid-api-gateway-benchmark.cjs \
  --url https://socket.leaf.app.br \
  --http-path /health/liveness \
  --socket-url https://socket.leaf.app.br \
  --http-count 12 \
  --http-concurrency 3 \
  --socket-count 6 \
  --socket-concurrency 3 \
  --socket-hold-ms 150 \
  --label lea-90-pre-maintenance
```

On the VPS, capture host/container state without printing secrets:

```bash
ssh -i ~/.ssh/leaf_contabo_20260412_ed25519 root@api.leaf.app.br
cd /opt/leaf-app
test -f /var/run/reboot-required && cat /var/run/reboot-required || echo "no reboot-required file"
apt list --upgradable
free -h
df -h / /var/lib/docker
ps -eo stat= | grep -Ec "^Z" || true
docker compose ps
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker exec leaf-redis redis-cli -a "$REDIS_PASSWORD" ping
docker exec leaf-nginx nginx -T 2>/dev/null | grep -E "upstream leaf_backend|server websocket|least_conn|keepalive"
docker stats --no-stream
```

## Minimal Rollback Package

Create a root-only backup before touching packages:

```bash
cd /opt/leaf-app
BACKUP_DIR=/opt/leaf-maintenance-backups/lea-90-$(date +%Y%m%d%H%M%S)
mkdir -p "$BACKUP_DIR"
chmod 700 /opt/leaf-maintenance-backups "$BACKUP_DIR"
cp docker-compose.yml "$BACKUP_DIR/"
cp docker-compose.gateway-scale.yml "$BACKUP_DIR/" 2>/dev/null || true
cp nginx.conf "$BACKUP_DIR/" 2>/dev/null || true
cp nginx.multi-gateway.conf "$BACKUP_DIR/" 2>/dev/null || true
cp .env "$BACKUP_DIR/.env"
docker compose config > "$BACKUP_DIR/docker-compose.config.rendered.yml"
docker ps --format "{{.Names}} {{.Image}} {{.Status}}" > "$BACKUP_DIR/docker-ps.txt"
docker image ls --format "{{.Repository}}:{{.Tag}} {{.ID}}" | grep -E "leaf|redis|nginx" > "$BACKUP_DIR/docker-images.txt" || true
```

Confirm Docker and container restart policies:

```bash
systemctl is-enabled docker
systemctl is-active docker
docker inspect $(docker ps --format "{{.Names}}" | grep "^leaf-") \
  --format "{{.Name}} restart={{.HostConfig.RestartPolicy.Name}}" | sort
```

Expected policy for Leaf containers: `unless-stopped`.

## Update And Reboot

```bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y \
  -o Dpkg::Options::="--force-confdef" \
  -o Dpkg::Options::="--force-confold" \
  upgrade

test -f /var/run/reboot-required && reboot
```

Wait for SSH to return before validating:

```bash
for i in $(seq 1 90); do
  ssh -i ~/.ssh/leaf_contabo_20260412_ed25519 -o ConnectTimeout=3 root@api.leaf.app.br 'date -Is; uptime' && break
  sleep 5
done
```

## Post-Reboot Validation

Wait at least 25 seconds after SSH returns, then run:

```bash
bash scripts/healthcheck-vps.sh https://api.leaf.app.br
node leaf-websocket-backend/scripts/stress-test/no-paid-api-gateway-benchmark.cjs \
  --url https://socket.leaf.app.br \
  --http-path /health/liveness \
  --socket-url https://socket.leaf.app.br \
  --http-count 12 \
  --http-concurrency 3 \
  --socket-count 6 \
  --socket-concurrency 3 \
  --socket-hold-ms 150 \
  --label lea-90-post-maintenance
```

On the VPS:

```bash
cd /opt/leaf-app
test -f /var/run/reboot-required && cat /var/run/reboot-required || echo "no reboot-required file"
apt list --upgradable 2>/dev/null | tail -n +2 | wc -l
ps -eo stat= | grep -Ec "^Z" || true
systemctl is-active docker
docker compose ps
docker exec leaf-redis redis-cli -a "$REDIS_PASSWORD" ping
docker exec leaf-nginx nginx -T 2>/dev/null | grep -E "upstream leaf_backend|server websocket|least_conn|keepalive"
docker stats --no-stream
```

## 2026-06-06 Maintenance Evidence

- Updated 19 packages, including Docker, containerd, Docker Compose plugin, AppArmor, cloud-init, snapd, rsyslog and open-vm-tools.
- Reboot completed successfully.
- Post-reboot: no `reboot-required` file, `upgradable_count=0`, `zombie_count=0`.
- Docker returned `active`.
- Redis returned `PONG`.
- Nginx upstream kept `least_conn` across `websocket`, `websocket-gateway-2` and `websocket-gateway-3`.
- All Leaf compose services returned healthy shortly after reboot.
- Public healthcheck returned all core checks OK. `/api/kyc/health` is intentionally treated as Firebase-user protected, not an open VPS health endpoint.
- No-paid-API benchmark post-maintenance:
  - HTTP: 12/12 success, avg 517.67 ms, p95 792 ms.
  - Socket: 6/6 success, avg 952.67 ms, p95 1020 ms.

Local evidence directory:

```text
artifacts/lea-90-contabo-maintenance/
```
