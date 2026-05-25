# Pilot Controlled Live Operations Runbook

Data: 2026-04-06
Objetivo: acompanhar a janela assistida do piloto com uma leitura simples e contínua de saúde, corridas e sinais operacionais do backend.

## Estado esperado antes de abrir

- Produto: `GO_CANDIDATE`
- Launch-hour: `GO`
- `/health`: estável em `200`
- `leaf-pricing-baseline-worker`: parado nesta primeira janela

## Comandos recomendados

### Health contínuo

```bash
bash /Users/izaakdias/Documents/Leaf-new/scripts/validation/watch-pilot-health.sh https://api.147.182.204.181.sslip.io
```

### Operação contínua

```bash
bash /Users/izaakdias/Documents/Leaf-new/scripts/validation/watch-pilot-operations.sh https://api.147.182.204.181.sslip.io
```

### Janela curta com resumo único

```bash
WINDOW_MINUTES=15 INTERVAL_SECONDS=15 bash /Users/izaakdias/Documents/Leaf-new/scripts/validation/run-pilot-live-operations-window.sh
```

Se houver token administrativo:

```bash
LEAF_ADMIN_BEARER_TOKEN=SEU_TOKEN WINDOW_MINUTES=15 INTERVAL_SECONDS=15 bash /Users/izaakdias/Documents/Leaf-new/scripts/validation/run-pilot-live-operations-window.sh
```

Se você não exportar token, o wrapper tenta autenticar sozinho com o fluxo admin padrão do backend usando `admin@leaf.com` e `admin123`, a menos que você desabilite isso com `AUTO_LOGIN_ADMIN_TOKEN=false`.

## O que observar no watcher operacional

- `status=FAIL`
  - algum endpoint público essencial falhou
  - se houver token, também vale para falha em observabilidade e financeiro autenticados
- `activity_anomaly=yes`
  - a atividade recente respondeu, mas com descrições degradadas, como `Corrida undefined`
  - isso não precisa derrubar a janela sozinho, mas merece triagem no mesmo dia
- `rides_metric_anomaly=yes`
  - o endpoint de rides respondeu, mas os contadores parecem incoerentes, por exemplo `active_rides` muito acima de `total_rides`
  - isso também não precisa derrubar a janela sozinho, mas merece correção de telemetria
- `active_rides`
  - ajuda a confirmar se o backend está vendo corridas em curso
- `completed_today`
  - ajuda a confirmar progressão real da operação
- `financial_total_value` e `financial_total_rides`
  - só aparecem com token; úteis para settlement básico do piloto
- `websocket_connections`
  - só aparece com token; ajuda a detectar queda sistêmica de conexão

## Critérios de continuidade

Manter a janela assistida se:

- watcher de health sem `503`
- sem `health=unhealthy`
- sem `system=critical`
- watcher operacional sem `status=FAIL`
- corridas seguem completando
- não há charge duplicado ou ride zumbi confirmado

## Critérios de pausa imediata

Pausar a janela se ocorrer qualquer um destes:

- `/health` retorna `503`
- `system=critical` de forma repetida
- watcher operacional começa a falhar em endpoints essenciais
- charge duplicado
- ride zumbi
- dispatch para motorista inelegível
- reconnect quebra corrida ativa

## Artefatos gerados

O wrapper da janela salva tudo em:

- `reports/pilot-live-ops/<timestamp>/health-watch.log`
- `reports/pilot-live-ops/<timestamp>/operations-watch.log`
- `reports/pilot-live-ops/<timestamp>/summary.md`

## Runbooks relacionados

- launch-hour:
  - [PILOT_CONTROLLED_LAUNCH_HOUR_RUNBOOK_2026-04-06.md](/Users/izaakdias/Documents/Leaf-new/docs/PILOT_CONTROLLED_LAUNCH_HOUR_RUNBOOK_2026-04-06.md)
- go/no-go:
  - [PILOT_CONTROLLED_GO_CHECKLIST_2026-04-05.md](/Users/izaakdias/Documents/Leaf-new/docs/PILOT_CONTROLLED_GO_CHECKLIST_2026-04-05.md)
- rollback:
  - [PILOT_CONTROLLED_ROLLBACK_RUNBOOK_2026-04-05.md](/Users/izaakdias/Documents/Leaf-new/docs/PILOT_CONTROLLED_ROLLBACK_RUNBOOK_2026-04-05.md)
- blocker e mitigação:
  - [PILOT_CONTROLLED_LIVE_BLOCKER_2026-04-06.md](/Users/izaakdias/Documents/Leaf-new/docs/PILOT_CONTROLLED_LIVE_BLOCKER_2026-04-06.md)
