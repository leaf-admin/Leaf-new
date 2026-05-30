# Multi Gateway Contabo

## Objetivo

Reintroduzir paralelismo real no realtime sem voltar ao `websocket-secondary` orfao.

O desenho atual roda tres processos Node.js de gateway no mesmo host Contabo:

- `leaf-websocket`
- `leaf-websocket-gateway-2`
- `leaf-websocket-gateway-3`

Todos entram no upstream unico do Nginx e usam Socket.IO Redis Adapter obrigatorio.

## Por que isso existe

Node.js executa JavaScript de aplicacao em uma thread principal por processo. Aumentar o limite de CPU de um unico processo para `4 vCPU` nao faz esse processo usar quatro cores de forma proporcional no caminho quente de WebSocket.

Para o nosso caso, faz mais sentido ter multiplos processos Node.js menores, cada um com seu proprio event loop, do que um processo unico com limite alto.

## O que mudou em LEA-88

- `websocket-secondary` continua proibido como container solto.
- O compose passa a declarar replicas gerenciadas:
  - `websocket-gateway-2`
  - `websocket-gateway-3`
- O Nginx usa `least_conn` para distribuir conexoes entre os tres gateways.
- O Redis Adapter e obrigatorio em todos os gateways.
- Polling do Socket.IO fica desligado por padrao.
- Jobs/schedulers ficam desligados nos gateways extras para evitar execucao duplicada.
- O Nginx ganhou limite explicito de memoria e CPU no overlay.

## Topologia atual

```text
cliente mobile
  |
  v
leaf-nginx
  |
  +-- leaf-websocket            gateway + jobs autorizados
  +-- leaf-websocket-gateway-2  gateway puro
  +-- leaf-websocket-gateway-3  gateway puro
  |
  v
leaf-redis
```

Workers separados:

- `leaf-queue-worker`
- `leaf-sideeffects-worker`
- `leaf-billing-worker`

## Guardrails obrigatorios

Nos gateways extras:

- `RUNTIME_ROLE=gateway`
- `LEAF_SERVER_RUNTIME=modular`
- `ENABLE_SOCKETIO_REDIS_ADAPTER=true`
- `REQUIRE_SOCKETIO_REDIS_ADAPTER=true`
- `RUNTIME_ENABLE_QUEUE_WORKER=false`
- `ENABLE_RUNTIME_RADIUS_EXPANSION_MANAGER=false`
- `ENABLE_DRIVER_POOL_MONITOR=false`
- `ENABLE_ACCEPTED_RIDE_RECOVERY_MONITOR=false`
- `ENABLE_RUNTIME_DEMAND_NOTIFICATION_SERVICE=false`
- `ENABLE_RUNTIME_DASHBOARD_WEBSOCKET=false`
- `ENABLE_RUNTIME_CLEANUP_JOB=false`
- `ENABLE_CONNECTION_CLEANUP_SERVICE=false`
- `DAILY_EARNINGS_REPORT_ENABLED=false`
- `RIDE_FINALIZATION_OUTBOX_ENABLED=false`
- `SUBSCRIPTION_DAILY_BILLING_ENABLED=false`

## Distribuicao de recursos

Overlay atual:

| Servico | CPU | Memoria |
| --- | ---: | ---: |
| `websocket` | `1.10` | `1536m` |
| `websocket-gateway-2` | `1.10` | `1536m` |
| `websocket-gateway-3` | `1.10` | `1536m` |
| `nginx` | `0.75` | `512m` |
| `redis` | `0.75` | `2048m` |
| `queue-worker` | `0.50` | `768m` |
| `sideeffects-worker` | `0.75` | `1024m` |
| `billing-worker` | `0.50` | `768m` |

## Resultado medido

Baseline single gateway:

- HTTP `400/40`: `100%`, avg `388.67ms`, p95 `1020ms`, p99 `1643ms`, throughput `97.09/s`.
- Socket `180/36`: `100%`, avg `1160.31ms`, p95 `2050ms`, p99 `2390ms`, throughput `24.48/s`.

Tres gateways, antes de retunar Nginx/workers:

- HTTP `400/40`: `100%`, avg `447.85ms`, p95 `878ms`, p99 `1876ms`, throughput `85.74/s`.
- Socket `180/36`: `100%`, avg `1375.96ms`, p95 `2243ms`, p99 `2779ms`, throughput `21.14/s`.

Tres gateways, apos retune de recursos:

- HTTP `400/40`: `100%`, avg `464.45ms`, p95 `1316ms`, p99 `1520ms`, throughput `83.30/s`.
- Socket `180/36`: `100%`, avg `1486.84ms`, p95 `2189ms`, p99 `2864ms`, throughput `20.73/s`.

Canary sustentada, `180` sockets com `15s` de permanencia:

- HTTP `300/30`: `100%`, avg `342.79ms`, p95 `740ms`, p99 `927ms`, throughput `47.68/s`.
- Socket `180/60`: `100%`, avg `1325.88ms`, p95 `2296ms`, p99 `3368ms`, throughput `3.57/s`.
- Readiness publico `30` amostras: `100%`, avg `269.03ms`, p95 `425ms`, p99 `744ms`.
- `docker stats`: gateways ficaram saudaveis, memoria estavel entre `139MiB` e `145MiB` de `1536MiB`; Nginx ficou em cerca de `27MiB` de `512MiB`.

Leitura:

- A mudanca nao melhorou latencia de burst curto medida pela internet publica.
- A mudanca aumenta isolamento e headroom de CPU para conexoes concorrentes e fan-out realtime.
- Para latencia pura de handshake, o perfil single gateway ainda foi melhor neste teste.
- O beneficio esperado aparece mais em carga sustentada e uso real de event loop, nao em conexoes curtas seguradas por `150ms`.
- Na canary sustentada, a topologia ficou estavel e sem falhas; portanto a decisao operacional e manter observado, com rollback pronto se o app real mostrar regressao.

## Deploy

No host Contabo:

```bash
cd /opt/leaf-app
docker compose -f docker-compose.yml -f docker-compose.gateway-scale.yml config --services
docker compose -f docker-compose.yml -f docker-compose.gateway-scale.yml up -d --build websocket websocket-gateway-2 websocket-gateway-3
docker compose -f docker-compose.yml -f docker-compose.gateway-scale.yml up -d --no-deps nginx
docker exec leaf-nginx nginx -t
```

## Validacao

```bash
docker compose -f docker-compose.yml -f docker-compose.gateway-scale.yml ps
docker exec leaf-nginx nginx -T | sed -n '/upstream leaf_backend/,/}/p'
docker stats --no-stream
curl -fsS https://socket.leaf.app.br/health/liveness
```

Local:

```bash
npm --prefix leaf-websocket-backend run smoke:runtime-redis-adapter
npm --prefix leaf-websocket-backend run smoke:runtime-full-ride-flow
npm --prefix leaf-websocket-backend run smoke:runtime-critical-events
node leaf-websocket-backend/scripts/stress-test/no-paid-api-gateway-benchmark.cjs \
  --url https://socket.leaf.app.br \
  --http-path /health/liveness \
  --http-count 400 \
  --http-concurrency 40 \
  --socket-count 180 \
  --socket-concurrency 36 \
  --socket-hold-ms 150 \
  --timeout-ms 10000 \
  --label lea-88-after-resource-retune-three-gateways
```

## Rollback

Rollback seguro para single gateway:

1. Remover `websocket-gateway-2` e `websocket-gateway-3` do upstream Nginx.
2. Recarregar Nginx.
3. Derrubar replicas extras pelo compose.
4. Manter `websocket` principal e workers.

Comandos:

```bash
cd /opt/leaf-app
cp backups/<backup>/nginx.multi-gateway.conf ./nginx.multi-gateway.conf
docker exec leaf-nginx nginx -t
docker exec leaf-nginx nginx -s reload
docker compose -f docker-compose.yml -f docker-compose.gateway-scale.yml stop websocket-gateway-2 websocket-gateway-3
```

## Decisao operacional

Manter multi-gateway como capacidade gerenciada e previsivel, mas nao tratar como otimizacao de latencia de curto prazo.

Se a proxima canary real mostrar qualquer regressao de experiencia, voltar para single gateway e manter o multi-gateway documentado para carga sustentada, ou migrar a estrategia para segundo host dedicado.
