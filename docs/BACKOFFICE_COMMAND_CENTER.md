# Backoffice Command Center

O Command Center e a tela diaria de operacao do backoffice Leaf.

## Objetivo

Concentrar o contexto necessário para a operação diária em uma chamada barata e cacheada, com prioridade para a fila de atenção:

- status dos servicos;
- metricas operacionais do dia;
- suporte em aberto;
- cadastro de motoristas;
- custo e receita operacional.

Campanhas continuam disponíveis por drill-down quando `campaignCenterEnabled` está habilitado no perfil de lançamento. Quando o flag está desligado, o dashboard não apresenta links ou ações de campanha.

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

Default: 90s. Minimo: 30s. Maximo: 300s.

O dashboard consulta o snapshot a cada 60s somente enquanto a aba esta visivel.
Com o TTL default, uma aba alterna entre `MISS` e `HIT`, em vez de refazer a
agregacao cara em todo refresh. Abas ocultas nao consultam o endpoint.

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

As janelas de operacao diaria sao agrupadas por tarefa:

- `/dashboard`: visão geral, fila **Atenção agora**, canary, custo e saúde agregada.
- **Operação**: `/support`, `/drivers/review-queue`, `/drivers`, `/users`, `/maps` e `/waitlist`.
- **Financeiro**: `/subscriptions`, `/financial-reconciliation`, `/reports` e `/payment-runtime`.
- **Crescimento**: `/notifications`, `/promotions`, `/programs` e `/campaign-center` quando habilitados.
- **Sistema**: `/observability`, `/metrics`, `/audit` e históricos.

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
   - bloco `Atenção agora` sem item crítico sem responsável;
   - motoristas ativos, corridas em tempo real, GMV, receita e ARPU coerentes;
   - bloco `Controle de custo` sem alerta.
2. Abrir `/support` quando houver backlog, SLA em risco, chat N0 ou ticket escalado.
3. Abrir `/campaign-center` somente para publicar, pausar ou auditar campanha.
4. Abrir `/drivers/review-queue` para revisar pendencias de cadastro.
5. Abrir `/financial-reconciliation` apos canary, corrida real ou alerta financeiro.
6. Abrir `/audit` quando houver acao sensivel, mudanca de status, bloqueio, reativacao ou investigacao.

Evite manter telas de drill-down abertas em varios navegadores. O painel diario foi feito para ficar aberto sem multiplicar leituras. As telas operacionais pausam polling quando a aba esta oculta; suporte N0 usa Socket.IO como caminho principal e polling lento apenas como fallback.

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

`/observability` e uma tela tecnica e ainda faz varias chamadas internas para diagnostico. O polling default e de 60s, pausa quando a aba esta oculta e pode ser configurado por:

`NEXT_PUBLIC_OBSERVABILITY_POLL_MS`

O health Firebase real e cacheado por cinco minutos por processo para evitar
leituras repetidas sem evento novo. A latencia somente gera warning acima de
2,5s por default; 1,27s continua sendo reportado como metrica, nao como falha.

Variaveis:

- `HEALTH_FIREBASE_CACHE_TTL_MS`: default `300000`.
- `HEALTH_FIREBASE_WARNING_MS`: default `2500`.
- `HEALTH_FIREBASE_UNHEALTHY_MS`: default `8000`.

O uso recomendado no dia a dia e manter `/dashboard` aberto e abrir `/observability` somente para investigacao.
