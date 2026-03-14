# Scalability Hardening Report (Final)

Date: 2026-03-06
Target: `http://147.182.204.181:3001`

## What was implemented
1. Event rate limiting with explicit scope (`user` vs `user+ip`) for critical actions.
2. Queue backpressure in `createBooking` with `retryAfterSec` and supply-aware bypass.
3. Timeout guard in `confirmPayment` for holding persistence (`PAYMENT_HOLDING_TIMEOUT_MS`).
4. Duplicate request responses now include `retryAfterSec`.
5. Dedicated auth lane admission for `authenticate` (`AUTH_VERIFY_*`) to prevent verify token burst saturation.
6. Soak runner for repeated multi-user rounds.

## Files changed
- `leaf-websocket-backend/server.js`
- `leaf-websocket-backend/services/rate-limiter-service.js`
- `leaf-websocket-backend/scripts/stress-test/soak-multi-user.js`

## Key tuning applied
- `SOCKET_ADMISSION_MAX_INFLIGHT=220`
- `SOCKET_ADMISSION_MAX_QUEUE=1200`
- `SOCKET_ADMISSION_MAX_WAIT_MS=2500`
- `AUTH_VERIFY_MAX_INFLIGHT=160`
- `AUTH_VERIFY_MAX_QUEUE=1200`
- `AUTH_VERIFY_MAX_WAIT_MS=6000`
- `QUEUE_PENDING_LIMIT_PER_REGION=5000`
- `QUEUE_BACKPRESSURE_MIN_ONLINE_DRIVERS_BYPASS=200`

## Test results

### A) Multi-user 10k:1k (socket concurrency 300)
Final run: `stress-test-multi-user-1772811336272.json`
- Success rate: **100%**
- Throughput: **65.05 req/s**
- p95 latency: **5416 ms**
- Errors: none

### B) E2E full rides (300 simultaneous rides, concurrency 300)
Final run: `stress-test-e2e-rides-1772811304539.json`
- Success rate: **100%**
- Completed rides/s: **13.06**
- p95 latency: **22467 ms**
- Errors: none

### C) Soak test (post-auth-lane)
Run: `soak-multi-user-1772811399224.json`
Scenario: 5000:500, concurrency 200, 3 rounds
- Success rate: **100% in all rounds**
- Throughput: **63.88 to 67.48 req/s**
- p95 latency aggregate: **3301 ms**
- Failed requests: **0**

## Runtime health
- `/health`: healthy (Redis/Firebase/WebSocket healthy)
- `/otel/health`: success=true, ingest active, last status 200

## Conclusion
- Current setup is now significantly more resilient for burst traffic without increasing VPS resources.
- The prior auth/connect timeout hotspot was mitigated by dedicated auth admission lane.
- For launch-day peak readiness, this build is in a much safer state than previous baseline.
