# Leaf Secondary Contingency

## Scope

This is the low-resource first phase of Leaf contingency on the shared secondary VPS.
It provides:

- a restricted SSH tunnel to the primary Redis and backend loopback ports;
- a persistent, read-only Redis replica;
- an Nginx edge canary that can reach the primary backend without using the primary Nginx.

It does not automatically change DNS, Caddy, Redis authority or application traffic.
It also does not claim full primary-host continuity: an independent Leaf gateway needs the
remaining runtime/provider credentials and a separate approved deployment step.

## Resource budget

The compose hard-limits the contingency layer to 960 MiB RAM and 0.90 CPU in total:

- tunnel: 64 MiB / 0.15 CPU;
- Redis replica: 768 MiB / 0.50 CPU;
- edge canary: 128 MiB / 0.25 CPU.

No Leaf worker, scheduler, billing process or paid-provider call runs on this host.

## Required files on the secondary host

Install under `/opt/leaf-contingency`:

```text
docker-compose.contingency-secondary.yml
Dockerfile.contingency-tunnel
config/secondary-contingency/nginx.conf
scripts/ops/start-secondary-redis-replica.sh
scripts/ops/preflight-secondary-contingency.sh
secrets/primary_ssh_key
secrets/primary_known_hosts
secrets/redis_password
```

Secret permissions must be `0400`; directories containing them must be `0700`.
The dedicated primary key must be source-IP restricted and limited with `permitopen` to:

- `127.0.0.1:6379`;
- `127.0.0.1:3001`.

Strict host-key checking is mandatory. Do not copy the primary host's general-purpose SSH key.

## Start and validate

```bash
cd /opt/leaf-contingency
PRIMARY_SSH_HOST=<primary-ip> docker compose \
  -f docker-compose.contingency-secondary.yml up -d --build
PRIMARY_SSH_HOST=<primary-ip> \
  sh scripts/ops/preflight-secondary-contingency.sh
```

The canary is intentionally published only as `127.0.0.1:18080`. The existing Caddy can
reach `edge-canary:8080` through `lensury_edge`, but no Leaf route is added during staging.

## Failover boundaries

### Primary Nginx unavailable, primary backend healthy

After explicit operational approval, add the Leaf hostnames to the secondary Caddy and point
DNS to the secondary VPS. Route both hostnames to `edge-canary:8080`. Validate TLS, liveness,
Socket.IO and ride smokes before accepting traffic.

### Primary host unavailable

Do not promote automatically. The replica remains the freshest recoverable Redis state. A full
failover requires an independently configured Leaf gateway and an approved decision to run:

```text
REPLICAOF NO ONE
```

Promotion is intentionally absent from automation so a transient tunnel failure cannot create
split brain.

## Rollback

```bash
cd /opt/leaf-contingency
PRIMARY_SSH_HOST=<primary-ip> docker compose \
  -f docker-compose.contingency-secondary.yml down
```

Do not use `down -v`: the named Redis volume is the recovery copy. Remove the dedicated public
key line from the primary host's `authorized_keys` only when permanently retiring the standby.
Caddy and DNS require no rollback while this stack remains staged.
