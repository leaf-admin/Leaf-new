# Pilot Controlled Go-Live P0 Runbook

Data: 2026-04-07  
Escopo: somente trilhos ativos do lifecycle atual da Leaf.

## P0 obrigatório antes de abrir

- `Safety real`
  - socket `reportIncident` e `emergencyContact` persistem incidente operacional real
  - incidente `safety`/`emergency` abre ticket `N1`
  - booking fica marcada com `opsReviewRequired=true`
- `Suporte 24/7 executável`
  - fila única ativa via `/api/support/queue/summary` e `/api/support/queue/backlog`
  - SLA de `ack` e `primeira resposta`
  - escalonamento automático por violação de SLA
- `Trust do passageiro`
  - bloqueio manual, unblock e watchlist via `/api/ops/passengers/:id/*`
  - `createBooking` bloqueia `SOFT_BLOCKED` e `HARD_BLOCKED`
- `Policy por área e horário`
  - `/api/ops/areas/policies`
  - `createBooking` respeita `dispatchMode=restricted`
- `Disputa/refund`
  - `/api/ops/disputes`
  - decisão auditável com refund via `processRefund`
- `Observabilidade`
  - `/api/ops/overview`
  - `/api/ops/alerts`
  - `/api/ops/incidents`
  - `/api/support/queue/summary`
- `Headroom`
  - nova bateria via `npm run ops:headroom:battery`

## War Room

- `Ops Commander`
- `Backend on-call`
- `Mobile on-call`
- `Support lead`
- `Payments lead`

Janela mínima:

- T-2h: preflight e carga curta
- T-30m: fila vazia ou explicada
- T+4h: observação assistida pós-onda

## Comandos

### Overview operacional

```bash
curl -H "Authorization: Bearer $LEAF_ADMIN_BEARER_TOKEN" \
  https://api.147.182.204.181.sslip.io/api/ops/overview
```

### Alertas operacionais

```bash
curl -H "Authorization: Bearer $LEAF_ADMIN_BEARER_TOKEN" \
  https://api.147.182.204.181.sslip.io/api/ops/alerts
```

### Fila de suporte

```bash
curl -H "Authorization: Bearer $LEAF_ADMIN_BEARER_TOKEN" \
  https://api.147.182.204.181.sslip.io/api/support/queue/summary
```

### Headroom 250/300/350

```bash
cd /Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend
npm run ops:headroom:battery -- --url https://api.147.182.204.181.sslip.io
```

## Gatilhos de HOLD imediato

- incidente `critical` sem ack
- `support queue` com `overdueAckCount > 0`
- `REASSIGNMENT_PENDING` preso por mais de 5 min
- `EARLY_ENDED_REVIEW` acima do limite operacional
- policy `restricted` ativando em praça core sem plano de contingência
- disputa/refund aberta crescendo sem owner

## Critério de GO controlado

- `/api/ops/overview` sem alertas críticos abertos
- `support queue` com `overdueAckCount = 0`
- sem incidente `critical` sem owner
- bateria `300` verde no relatório de headroom
- runbook de rollback conhecido pelo time

## Rollback

Em qualquer degradação séria, seguir:

- [PILOT_CONTROLLED_ROLLBACK_RUNBOOK_2026-04-05.md](/Users/izaakdias/Documents/Leaf-new/docs/PILOT_CONTROLLED_ROLLBACK_RUNBOOK_2026-04-05.md)
