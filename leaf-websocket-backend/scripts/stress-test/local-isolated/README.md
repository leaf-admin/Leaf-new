# Local isolated load-test stack

Runs the real backend (gateway + queue worker + sideeffects worker) on this
machine against **local Redis and the Firebase emulators of a `demo-` project**.
Nothing reaches production: `assert-isolated.cjs` refuses to run unless every
Firebase client points at a local emulator, Redis is local and no provider key
(Woovi, Google, Sentry) is set. Pix is simulated as paid (mock review charge).

## Start

```bash
# 1. Redis (separate port, no persistence)
redis-server --port 6390 --save '' --appendonly no --maxmemory 1gb

# 2. Firebase emulators (repo root; needs Java 21: brew openjdk@21)
PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npx --yes firebase-tools@14.22.0 \
  emulators:start --project demo-leaf-load --config config/firebase/firebase.json \
  --only auth,firestore,database,storage

# 3. Backend (leaf-websocket-backend/). LEAF_LOADTEST_SA = throwaway service
#    account JSON for demo-leaf-load (any RSA key; never a real credential).
export LEAF_LOADTEST_SA=/path/to/fake-sa.json LEAF_LOADTEST_LOG_DIR=/tmp/leaf-loadtest
bash scripts/stress-test/local-isolated/restart-backend.sh
```

## Run

```bash
. scripts/stress-test/local-isolated/env.sh
node scripts/stress-test/local-isolated/assert-isolated.cjs
node scripts/stress-test/sustained-active-rides-capacity.cjs --url http://127.0.0.1:3101 \
  --drivers 40 --passengers 40 --base-lat -22.9700 --base-lng -43.1950 \
  --spread-lat 0.010 --spread-lng 0.015 --windows "step:180:20:30:60" \
  --report-path /tmp/leaf-loadtest/step.json
```

Pickups must be inside `config/geofence.json` (currently Zona Sul). Read the
Redis side with `REDIS_URL=redis://127.0.0.1:6390 node scripts/ops/capacity-snapshot.cjs --targets http://127.0.0.1:3101`.

## Differences from production (on purpose)
- Pix is simulated as paid (`APP_REVIEW` + mock review charge); Woovi is never called.
- The biometric/KYC provider is dormant (`DAILY_KYC_ONLINE_GATE_ENABLED=false`);
  the canonical activation policy still runs. Synthetic drivers are seeded as
  fully activated in the emulator only.
- One gateway instead of three; numbers measure this machine, not the VPS.
