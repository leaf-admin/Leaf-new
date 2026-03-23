# Redis Padrão Produção (Leaf)

## Objetivo
Manter Redis **privado** e acessível apenas pelo backend em produção, sem túnel SSH para operação normal.

## Topologia recomendada
1. `mobile-app` e `dashboard` acessam apenas `API/WS` (HTTPS/WSS).
2. `backend` acessa Redis em rede privada (container network, localhost da VPS ou VPC).
3. Redis **não** deve ser exposto publicamente na internet.

## Regras de rede
- Liberar externamente somente:
  - `80/tcp`
  - `443/tcp`
  - `22/tcp` (admin)
- Bloquear externamente:
  - `6379/tcp` (Redis)
  - `3001/tcp` (ideal: interno/proxy via Nginx)

## Configuração de ambiente (backend)

### Cenário A: Backend + Redis no mesmo Docker Compose (recomendado)
Use host `redis`:

```env
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=leaf_redis_2024
REDIS_DB=0
REDIS_URL=redis://:leaf_redis_2024@redis:6379/0
```

### Cenário B: Backend fora de Docker, Redis local na VPS
Use loopback:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=leaf_redis_2024
REDIS_DB=0
REDIS_URL=redis://:leaf_redis_2024@127.0.0.1:6379/0
```

### Cenário C: Redis gerenciado (TLS)
Use `rediss://`:

```env
REDIS_URL=rediss://username:password@provider-host:port/0
REDIS_USE_TLS=true
REDIS_TLS_REJECT_UNAUTHORIZED=true
```

## Fluxo para múltiplas máquinas (dev/qa)
- Não conectar Redis direto da máquina do dev.
- Cada máquina aponta para a API pública (`https://api...`) e WebSocket (`wss://socket...`).
- Redis fica centralizado no ambiente de backend.

## Checklist de validação
1. `redis` sem bind público (`127.0.0.1` ou rede Docker interna).
2. Backend saudável com Redis:
   - `GET /health` com `checks.redis.status = healthy|warning` (não `unhealthy` por indisponibilidade).
3. `docker exec <backend> env | grep REDIS_` aponta para host privado correto.
4. `ss -ltnp | grep 6379` sem `0.0.0.0:6379`.

## Observação
Túnel SSH (`-L 6380:...`) é apenas fallback operacional temporário, não padrão de produção.
