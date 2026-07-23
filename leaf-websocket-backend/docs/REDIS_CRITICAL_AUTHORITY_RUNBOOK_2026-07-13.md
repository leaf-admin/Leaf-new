# Redis Critical Authority — activation and rollback

This runbook applies to the modular production runtime in
`docker-compose.production.yml` plus `docker-compose.gateway-scale.yml`.
It does not authorize a production deployment by itself.

## Contract

- Redis GEO, presence and matching remain the hot data plane.
- A new ride ownership or a new KYC verification window is allowed only when
  the live Redis attestation is green.
- An already-owned ride, an exact KYC token reuse and an active-ride lease
  renewal continue while new claims are quarantined.
- The application never creates, updates or repairs the dataset generation
  marker.
- Firestore/RTDB are not fallback authorities for this gate.

The approved runtime contract is:

```text
maxmemory-policy=noeviction
appendonly=yes
appendfsync=everysec
evicted_keys=0
memory thresholds=60/75/85 percent
Redis maxmemory=2304 MiB
Redis container memory limit=3072 MiB
vm.overcommit_memory=1
trip_location_events consumer group=trip-location-workers
trip_location_events live consumer idle<=30000ms
```

## Required values

Select a non-secret, immutable generation identifier for the reconciled Redis
dataset, for example `prod-2026-07-13-a`, and configure the same value in:

```text
REDIS_CRITICAL_DATASET_GENERATION
leaf:runtime:critical-dataset:generation
```

The environment value is intentionally blank in the example manifest. Never
commit the Redis password or a production environment file.

## Preflight before any restart

1. Take a recoverable snapshot/backup of the existing Redis volume.
2. Confirm the host prerequisite:

   ```bash
   sysctl -n vm.overcommit_memory
   ```

   Expected output: `1`.

3. Render and review both Compose files with the real deployment environment.
   The RC pins Redis to `7.4.9-alpine3.21` and its multi-platform OCI digest.
   Verify that exact digest is available on the target architecture and keep it
   unchanged throughout rollout and rollback evidence.
4. Confirm the Redis container cgroup limit is at least 3 GiB and therefore
   greater than the configured Redis maxmemory. This is minimum headroom, not
   proof against cgroup OOM: validate RSS, fragmentation and AOF rewrite/COW
   pressure on the target host before widening traffic.
5. Reconcile every non-terminal booking with its driver ownership and these
   Redis bindings:

   ```text
   active_trip_by_driver:<driverId>
   active_trip_customer_by_driver:<driverId>
   driver:<driverId>.activeTripId
   driver:<driverId>.activeTripLeaseUntilMs
   booking:<bookingId>.driverId/state/status
   ```

6. Confirm there is no active KYC window for a driver with an active ride and
   no active ride for a driver with a policy-mutation window.
7. Confirm the route stream consumer group exists and is moving:

   ```bash
   REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning XINFO GROUPS trip_location_events
   REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning XINFO CONSUMERS trip_location_events trip-location-workers
   REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning XPENDING trip_location_events trip-location-workers
   ```

   At least one consumer must report `idle <=
   TRIP_LOCATION_CONSUMER_MAX_IDLE_MS` (default `30000`). A group without a live
   consumer is not sufficient and keeps readiness quarantined. This gate is
   skipped only when `ENABLE_TRIP_LOCATION_STREAM=false`.

   The current production Compose does not start `worker-trip-location`. Adding
   that existing worker is a separate operational change and requires explicit
   approval. Until the group exists, readiness intentionally stays quarantined
   and new ride/KYC claims remain blocked.

8. Inspect the current marker using authenticated Redis CLI:

   ```bash
   REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning GET leaf:runtime:critical-dataset:generation
   REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning TTL leaf:runtime:critical-dataset:generation
   ```

If reconciliation is incomplete or any binding conflicts, stop. Do not create
or replace the marker.

The marker lives in the same Redis volume and therefore cannot, by itself,
detect restoration of an older backup that already contains the marker. Any
restore must begin quarantined, use a new generation identifier, complete full
ride/KYC reconciliation, and only then bootstrap that new marker under an
explicit incident/change approval. Never reuse the restored marker as evidence
that the restored dataset is current.

## Marker bootstrap

Only after reconciliation succeeds, create an absent marker without TTL:

```bash
REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning SET leaf:runtime:critical-dataset:generation "$REDIS_CRITICAL_DATASET_GENERATION" NX
```

Expected result: `OK`. If the result is empty, a marker already exists. Compare
it exactly with the expected generation; never overwrite a mismatch as part of
an automated deploy. A valid marker must return `-1` from `TTL`.

## Runtime verification

After starting the hardened Redis and gateways, verify with authenticated
commands:

```bash
REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning CONFIG GET maxmemory-policy
REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning CONFIG GET appendonly
REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning CONFIG GET appendfsync
REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning INFO persistence
REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning INFO stats
REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning INFO memory
```

Then inspect both endpoints separately:

```text
GET /health/liveness
GET /health/readiness
GET /health/runtime-flags
```

`liveness=200` is not acceptance evidence. Readiness must be `200`, and the KYC
section must report `activeTripAuthorityReady=true`, an attestation with
`ready=true`, no blockers, the expected memory level and
`streams.tripLocation.consumerGroupPresent=true` and
`streams.tripLocation.consumerActive=true`.

Before widening traffic, prove in the sandbox/staging runtime that:

- a missing or mismatched marker blocks a new ride claim and a new KYC claim;
- an idempotent accept for the same driver/booking continues;
- an exact existing KYC token can continue;
- an active ride lease renews without opening a new ownership claim;
- Redis GEO and eligible-driver matching still operate without a Firebase write
  in the location hot path.

## Quarantine response

At 60% memory, investigate growth. At 75%, stop non-essential Redis producers
and prepare remediation. At 85%, readiness and new critical claims fail closed.

The location stream uses a soft retention threshold. It trims only entries
older than the minimum safe boundary across every consumer group. If that
boundary cannot be proven, it deliberately grows and alerts instead of deleting
pending or unread route events.

`ride_events` follows the same consumer-group-aware policy from existing
workers after ACK. Its DLQ keeps the newest bounded diagnostic window (default
10,000 entries). Trim checks run outside the GPS and ACK hot paths.

Never solve quarantine by switching back to an eviction policy, deleting active
trip/KYC keys, or writing a new generation marker without reconciliation.

## Rollback

1. Keep the persistent Redis volume and its backup intact.
2. Stop new deployment traffic and restore the previous application/Compose
   revision.
3. Do not delete or rewrite the generation marker during an application
   rollback.
4. If rollback requires returning to an eviction policy, treat that as a new
   production-risk decision and obtain explicit approval; it is not an automatic
   rollback step.
5. Re-run liveness/readiness and reconcile active rides before reopening new
   accepts or KYC sessions.

Loss of the Redis host or volume remains an assisted-pilot residual risk. A
durable control-plane authority is required before claiming unassisted recovery
from total Redis data loss. The 3 GiB container limit also remains subject to a
real pressure and `BGREWRITEAOF` test; it must not be described as an OOM
guarantee.
