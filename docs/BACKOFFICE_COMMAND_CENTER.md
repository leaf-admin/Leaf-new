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

As paginas detalhadas continuam existindo para drill-down:

- `/observability`;
- `/support`;
- `/campaign-center`;
- `/metrics/marketplace`;
- `/maps`.

## Observabilidade detalhada

`/observability` e uma tela tecnica e ainda faz varias chamadas internas para diagnostico. O polling default foi reduzido para 30s e pode ser configurado por:

`NEXT_PUBLIC_OBSERVABILITY_POLL_MS`

O uso recomendado no dia a dia e manter `/dashboard` aberto e abrir `/observability` somente para investigacao.
