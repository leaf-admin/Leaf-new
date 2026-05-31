# Backoffice Command Center

O Command Center e a tela diaria de operacao do backoffice Leaf.

## Objetivo

Concentrar os quatro paineis necessarios para operacao diaria em uma chamada barata e cacheada:

- status dos servicos;
- metricas operacionais do dia;
- suporte em aberto;
- campanhas in-app.

## Endpoint canonico

`GET /api/ops/command-center?hours=1&period=today`

Esse endpoint agrega dados ja existentes no backend:

- `health-check-service`;
- `ops-overview-service`;
- `modern-metrics-service`;
- `support-queue-service` via overview;
- `campaign-center-service`;
- `WorkerHealthMonitor`.

O snapshot e cacheado em Redis com TTL controlado por:

`BACKOFFICE_COMMAND_CENTER_TTL_SECONDS`

Default: 20s. Minimo: 5s. Maximo: 120s.

## Regra de custo

O Command Center nao deve chamar APIs pagas ou de fornecedor externo.

Proibido neste caminho:

- Google Places;
- Google Routes;
- Google Directions;
- Woovi;
- qualquer endpoint de mapa externo.

A pagina `/maps` continua separada porque carregar Google Maps JS pode gerar custo de mapa. Ela nao deve ser usada como painel sempre aberto se o objetivo for controle de custo.

## Dashboard

A home do dashboard (`/dashboard`) deve consumir o Command Center como fonte primaria.

As quatro janelas de operacao diaria sao:

- `/dashboard`: visao geral diaria, servicos, motoristas ativos, corridas, GMV, receita e controle de custo.
- `/support`: fila N1/N2/N3, tickets, chat N0, SLA, ownership e copiloto/orquestrador.
- `/campaign-center`: campanhas in-app, surfaces, slots, assets, metricas comerciais e pacing.
- `/drivers/review-queue`: cadastro de motorista, fila de documentos e pendencias.

As paginas detalhadas continuam existindo para drill-down:

- `/observability`;
- `/support`;
- `/campaign-center`;
- `/drivers/review-queue`;
- `/financial-reconciliation`;
- `/audit`;
- `/metrics/marketplace`;
- `/maps`.

## Operacao diaria recomendada

1. Abrir `/dashboard` e confirmar:
   - status geral `saudavel`;
   - cache do Command Center em `HIT` ou com idade baixa;
   - motoristas ativos, corridas em tempo real, GMV, receita e ARPU coerentes;
   - bloco `Controle de custo` sem alerta.
2. Abrir `/support` quando houver backlog, SLA em risco, chat N0 ou ticket escalado.
3. Abrir `/campaign-center` somente para publicar, pausar ou auditar campanha.
4. Abrir `/drivers/review-queue` para revisar pendencias de cadastro.
5. Abrir `/financial-reconciliation` apos canary, corrida real ou alerta financeiro.
6. Abrir `/audit` quando houver acao sensivel, mudanca de status, bloqueio, reativacao ou investigacao.

Evite manter telas de drill-down abertas em varios navegadores. O painel diario foi feito para ficar aberto sem multiplicar leituras.

## Guardrail de leituras Firestore

O backoffice usa `backoffice-cost-guard-service` para estimar leituras Firestore por rota critica e acumular o uso diario em Redis.

Variaveis:

- `BACKOFFICE_FIRESTORE_DAILY_READ_BUDGET`: teto diario estimado de leituras. Default: `150000`.
- `BACKOFFICE_FIRESTORE_WARNING_RATIO`: alerta inicial. Default: `0.5`.
- `BACKOFFICE_FIRESTORE_DANGER_RATIO`: alerta forte. Default: `0.8`.
- `BACKOFFICE_FIRESTORE_LIMIT_RATIO`: teto. Default: `1`.
- `BACKOFFICE_FIRESTORE_READ_PRICE_USD_PER_100K`: preco estimado por 100k leituras. Default: `0.06`.

Headers expostos pelos endpoints instrumentados:

- `X-Leaf-Estimated-Firestore-Reads`
- `X-Leaf-Firestore-Read-Budget-Status`
- `X-Leaf-Firestore-Read-Budget-Usage`

Redis keys diarias:

- `backoffice:cost_guard:firestore_reads:YYYY-MM-DD`
- `backoffice:cost_guard:firestore_reads_by_route:YYYY-MM-DD`

Status esperado:

- `ok`: uso dentro do teto.
- `warning`: investigar polling, abas abertas e rotas de drill-down.
- `danger`: reduzir uso ao Command Center e pausar refresh manual repetido.
- `limit`: tratar como incidente operacional de custo antes de abrir novas telas de leitura pesada.

Rotas instrumentadas:

- `ops.commandCenter`
- `support.queue.summary`
- `support.queue.backlog`
- `support.chat.inbox`
- `support.chat.history`
- `drivers.documents.reviewQueue`
- `campaigns.list`
- `campaigns.get`
- `campaigns.stats`
- `campaigns.commercialReport`
- `campaigns.slots`
- `campaigns.previewEligibility`
- `financial.reconciliation.reports`
- `financial.reconciliation.ride`
- `financial.reconciliation.run`
- `audit.logs`
- `audit.stats`

Importante: o guardrail estima e monitora leituras. Ele nao deve substituir cache, paginacao e limites por endpoint.

## Observabilidade detalhada

`/observability` e uma tela tecnica e ainda faz varias chamadas internas para diagnostico. O polling default foi reduzido para 30s e pode ser configurado por:

`NEXT_PUBLIC_OBSERVABILITY_POLL_MS`

O uso recomendado no dia a dia e manter `/dashboard` aberto e abrir `/observability` somente para investigacao.
