# Segundo Host Realtime

## Importante
Este documento descreve **um segundo host realtime em outra VPS**.

Ele nao descreve o multi-gateway gerenciado dentro da Contabo atual. Esse outro desenho existe separadamente em:

- [MULTI_GATEWAY_CONTABO_RUNBOOK_2026-05-30.md](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/docs/MULTI_GATEWAY_CONTABO_RUNBOOK_2026-05-30.md)

A regra atual e:

- `websocket-secondary` solto/orfao no host principal continua proibido;
- `websocket-gateway-2` e `websocket-gateway-3` sao permitidos apenas quando declarados no compose ativo, com Redis Adapter obrigatorio e jobs duplicados desligados;
- segundo host realtime continua sendo o caminho de escala horizontal real quando a Contabo atual deixar de ter margem.

## Estado Atual

Em 2026-05-30, foi encontrado um `leaf-websocket-secondary` órfão ainda rodando no host principal, fora do `docker compose` ativo e com versão de código diferente do `leaf-websocket`.

A decisão operacional para `websocket-secondary` é:

- não manter `websocket-secondary` na mesma Contabo;
- não recolocar `websocket-secondary` no `nginx.multi-gateway.conf`;
- remover containers órfãos `leaf-websocket-secondary` do host principal;
- usar `docker-compose.realtime-secondary.yml` somente quando houver um segundo host real;
- só adicionar o segundo host ao upstream depois de validar versão, healthcheck, Socket.IO Redis adapter e smoke de corrida.

Se um `docker ps` voltar a mostrar `leaf-websocket-secondary` no host principal, trate como regressão de infraestrutura.

## Objetivo
Adicionar um segundo host apenas para `gateway realtime`, mantendo no host principal:

- `nginx`
- `redis`
- `sideeffects-worker`
- `billing-worker`
- um `websocket` principal

O segundo host entra para dividir:

- handshake/socket auth
- HTTP do lifecycle quente
- inline dispatch do `createBooking`
- fan-out de Socket.IO via Redis adapter

## Topologia

### Host principal
- host atual: Contabo principal, definido por segredo operacional
- endpoints públicos:
  - `https://api.leaf.app.br`
  - `https://socket.leaf.app.br`
- continua rodando:
  - `redis`
  - `nginx`
  - `websocket`
  - `sideeffects-worker`
  - `billing-worker`

### Host secundário
- roda só:
  - `websocket-secondary`
- não roda:
  - `redis`
  - `nginx`
  - `sideeffects-worker`
  - `billing-worker`
  - `queue worker`
  - `driver pool monitor`
  - `cleanup job`
  - `dashboard websocket service`

## Pré-requisito de Redis
O host principal precisa expor o Redis apenas no loopback local:

- `127.0.0.1:6379 -> redis:6379`

Isso já está preparado em:
- [docker-compose.production.yml](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/docker-compose.production.yml)

Depois disso, o host secundário consome o Redis do principal via túnel SSH local:

- secundário `127.0.0.1:6381`
- túnel para primário `127.0.0.1:6379`

## Passo 1 — Atualizar o host principal
No host principal:

```bash
cd /opt/leaf-app
docker compose up -d redis websocket nginx sideeffects-worker billing-worker
docker compose ps
ss -ltnp | grep 6379
```

Esperado:
- Redis ouvindo só em `127.0.0.1:6379`

## Passo 2 — Instalar túnel Redis no host secundário
Da máquina de operação/local:

```bash
scp /Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/scripts/ops/install-secondary-redis-tunnel.sh \
  root@<ip-do-segundo-host>:/root/
```

No host secundário:

1. copiar uma chave SSH que tenha acesso ao host principal
2. salvar em `/root/.ssh/leaf-primary-redis`
3. rodar:

```bash
PRIMARY_SSH_HOST=<host-contabo-principal> \
PRIMARY_SSH_USER=root \
TUNNEL_KEY_PATH=/root/.ssh/leaf-primary-redis \
bash /root/install-secondary-redis-tunnel.sh
```

Validar:

```bash
ss -ltnp | grep 6381
```

Esperado:
- `127.0.0.1:6381` no host secundário

## Passo 3 — Deploy do segundo gateway realtime
Da máquina de operação/local:

```bash
cd /Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend
VPS_IP=<ip-do-segundo-host> \
SSH_KEY=<caminho-da-chave-operacional> \
PRIMARY_REDIS_HOST=host.docker.internal \
PRIMARY_REDIS_PORT=6381 \
PRIMARY_REDIS_PASSWORD=<senha-redis-via-segredo-operacional> \
bash scripts/deploy/deploy-secondary-realtime-host.sh
```

Isso sobe:
- [docker-compose.realtime-secondary.yml](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/docker-compose.realtime-secondary.yml)

## Passo 4 — Colocar o segundo host no balanceamento
No `nginx` do host principal, acrescentar o segundo host no upstream:

```nginx
upstream leaf_backend {
    least_conn;
    server websocket:3001 max_fails=3 fail_timeout=10s;
    server <ip-do-segundo-host>:3001 max_fails=3 fail_timeout=10s;
    keepalive 128;
}
```

Depois:

```bash
nginx -t
docker compose restart nginx
```

## Validação
No host principal:

```bash
curl -fsS https://api.leaf.app.br/health | jq
docker stats --no-stream
```

No host secundário:

```bash
docker compose -f docker-compose.realtime-secondary.yml ps
curl -fsS http://127.0.0.1:3001/health/liveness
```

## Resultado esperado
- Redis central continua único
- Socket.IO Redis adapter mantém fan-out entre hosts
- host principal deixa de carregar sozinho todo handshake/realtime CPU
- `800` deixa de disputar o mesmo orçamento de CPU de um único host de `6 vCPU`

## Por Que Não Na Mesma VPS
Já validamos `2x realtime` no mesmo host atual e o resultado ficou pior ou equivalente ao melhor `single-node` forte.

Referências:
- [contabo-operational-margin-summary-2026-04-09.md](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/contabo-operational-margin-summary-2026-04-09.md)
- [contabo-headroom-800-long-sslip-retune-v3-bootstrapmax-20260409.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/contabo-headroom-800-long-sslip-retune-v3-bootstrapmax-20260409.json)
- [contabo-headroom-800-long-sslip-dualnode-v1-20260409.json](/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/contabo-headroom-800-long-sslip-dualnode-v1-20260409.json)
