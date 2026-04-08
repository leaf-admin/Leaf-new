# Pilot Controlled Go-Live P0 Implementation

Data: 2026-04-07

## Escopo respeitado

Esta implementação mexe apenas no runtime ativo do lifecycle atual:

- `leaf-websocket-backend/bootstrap/register-socket-create-booking-handler.js`
- `leaf-websocket-backend/bootstrap/register-socket-safety-support-handlers.js`
- `leaf-websocket-backend/bootstrap/register-http-routes.js`
- `leaf-websocket-backend/routes/support.js`
- `leaf-websocket-backend/routes/ops.js`
- serviços novos em `leaf-websocket-backend/services/*`

Nenhuma alteração foi feita no legado desligado.

## Serviços novos

- `passenger-trust-service.js`
  - score, watchlist, soft block, hard block
  - enforcement em `createBooking`
- `operational-area-policy-service.js`
  - policies por cidade/região/faixa horária
  - modes `normal|monitoring|tight|restricted`
  - enforcement em `createBooking`
- `support-queue-service.js`
  - fila única, SLA, backlog, escalonamento automático
- `safety-incident-service.js`
  - persistência de incidente
  - ticket `N1`
  - `opsReviewRequired` no booking
- `dispute-review-service.js`
  - fila manual de refund/disputa
  - decisão auditável
- `ops-overview-service.js`
  - consolidação operacional para dashboard atual

## Endpoints novos

- `/api/ops/overview`
- `/api/ops/alerts`
- `/api/ops/incidents`
- `/api/ops/incidents/:id`
- `/api/ops/incidents/:id/ack`
- `/api/ops/incidents/:id/resolve`
- `/api/ops/passengers/:id/trust`
- `/api/ops/passengers/:id/watchlist`
- `/api/ops/passengers/:id/block`
- `/api/ops/passengers/:id/unblock`
- `/api/ops/areas/policies`
- `/api/ops/areas/policies/:id/activate`
- `/api/ops/areas/policies/:id/deactivate`
- `/api/ops/disputes`
- `/api/ops/disputes/:id/decision`
- `/api/support/queue/summary`
- `/api/support/queue/backlog`
- aliases ativos:
  - `/api/support/tickets/:id/assign`
  - `/api/support/tickets/:id/escalate`
  - `/api/support/tickets/:id/resolve`

## Hooks no lifecycle ativo

### Safety / emergency

- `reportIncident`
- `emergencyContact`
- `createSupportTicket`

Agora persistem em trilho operacional real.

### Booking

`createBooking` agora:

- barra passageiro `SOFT_BLOCKED` / `HARD_BLOCKED`
- aplica policy operacional por área/hora
- registra request aceito por policy ativa

## Testes adicionados

- `tests/unit/services/passenger-trust-service.unit.test.js`
- `tests/unit/services/operational-area-policy-service.unit.test.js`
- `tests/unit/services/support-queue-service.unit.test.js`
- `tests/unit/services/safety-incident-service.unit.test.js`
- `tests/unit/services/dispute-review-service.unit.test.js`

## Harness de headroom

Runner novo:

- `leaf-websocket-backend/scripts/tests/run-go-live-headroom-battery.cjs`

Script npm:

- `npm run ops:headroom:battery -- --url <base-url>`

Saída:

- `leaf-websocket-backend/reports/go-live-headroom-<timestamp>/summary.json`
- `leaf-websocket-backend/reports/go-live-headroom-<timestamp>/summary.md`
