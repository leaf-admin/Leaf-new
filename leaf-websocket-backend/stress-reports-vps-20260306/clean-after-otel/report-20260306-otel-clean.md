# Clean Test Report (Post-OTEL Endpoint Fix)

Date: 2026-03-06
Target: http://147.182.204.181:3001

## 1) OTEL Validation
- `/otel/health`: `success=true`, endpoint `http://127.0.0.1:3001/otel`, ingest status `200`.
- `/api/metrics/observability` now includes `otel` payload consumed by dashboard.

## 2) E2E Rides (300 simultaneous)
Source:
- `stress-test-e2e-rides-1772808627079-vps-clean.json`
- `e2e-300-conc300-20260306-115026.log`

Result:
- total: 300
- success: 247
- failed: 53
- successRate: 82.33%
- ridesPerSec: 11.64
- completedRidesPerSec: 9.58
- p95 latency: 24.8s
- top errors: `unknown:timeout`, `connect/auth:connect_timeout`

## 3) Multi-user 10k:1k (conc 300)
Source:
- `stress-test-multi-user-1772808679246-vps-clean.json`
- `multi-10000x1000-conc300-20260306-115119.log`

Result:
- successRate: 58.8%
- throughput: 57.97 req/s
- p95: 7.04s
- top error: `connect:websocket error`

## 4) Multi-user 10k:1k (conc 150)
Source:
- `stress-test-multi-user-1772808746568-vps-clean.json`
- `multi-10000x1000-conc150-20260306-115226.log`

Result:
- successRate: 100%
- throughput: 48.24 req/s
- p95: 3.36s
- errors: none

## Conclusion
- OTEL endpoint is valid and dashboard consumption is aligned.
- Current architecture is stable at this load with socket concurrency around 150.
- At 300 concurrent socket flows, handshake/connect failures become dominant.
