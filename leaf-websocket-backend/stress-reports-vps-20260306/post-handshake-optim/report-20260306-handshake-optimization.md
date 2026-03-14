# Handshake/Socket Peak Optimization Report

Date: 2026-03-06
Target: `http://147.182.204.181:3001`

## Changes applied
- Backend:
  - Added Socket.IO admission control queue (inflight/queue/wait/hold) in `server.js`.
  - Admission slot now held until auth success/failure/disconnect (with safety timeout).
  - Default transport policy changed: polling disabled by default in production unless explicitly enabled.
- Mobile:
  - `WebSocketManager` now avoids aggressive manual reconnect storms.
  - Keeps one persistent socket strategy with socket.io reconnect first.
  - Increased reconnect window and removed duplicate reconnect scheduling.

## Final admission defaults (current code)
- `SOCKET_ADMISSION_ENABLED=true`
- `SOCKET_ADMISSION_MAX_INFLIGHT=220`
- `SOCKET_ADMISSION_MAX_QUEUE=1200`
- `SOCKET_ADMISSION_MAX_WAIT_MS=2500`
- `SOCKET_ADMISSION_HOLD_MS=10000`

## Before vs After

### Multi-user 10k drivers : 1k passengers (socket concurrency 300)
- Before (clean-after-otel):
  - successRate: **58.8%**
  - throughput: **57.97 req/s**
  - p95 latency: **7042 ms**
  - dominant error: `connect:websocket error`
- After (tuned admission): `stress-test-multi-user-1772809502122.json`
  - successRate: **100%**
  - throughput: **64.65 req/s**
  - p95 latency: **4781 ms**
  - errors: **none**

### Multi-user 10k : 1k (socket concurrency 150)
- Before:
  - successRate: **100%**
  - throughput: **48.24 req/s**
  - p95 latency: **3363 ms**
- After:
  - successRate: **100%**
  - throughput: **42.72 req/s**
  - p95 latency: **3706 ms**

### E2E rides (300 simultaneous rides)
- Before (clean-after-otel):
  - successRate: **82.33%**
  - completedRidesPerSec: **9.58**
  - p95 latency: **24828 ms**
  - top errors: timeouts/auth connect timeout
- After (tuned admission): `stress-test-e2e-rides-1772809529328.json`
  - successRate: **100%**
  - completedRidesPerSec: **13.65**
  - p95 latency: **21603 ms**
  - errors: **none**

## Observability validation
- OTEL endpoint healthy: `/otel/health` returns `success=true`.
- OTEL ingest active with `lastStatusCode=200`.
- System checks: Redis/Firebase/WebSocket healthy.

## Conclusion
- The handshake/socket peak issue improved significantly without increasing VPS resources.
- The tuned admission window removes connect storms and stabilizes auth/connect under burst.
- Current architecture is now stable for the tested 10k:1k and 300 simultaneous E2E ride scenario.
