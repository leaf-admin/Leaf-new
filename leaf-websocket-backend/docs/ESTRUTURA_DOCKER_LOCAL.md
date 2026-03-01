# 🐳 Estrutura Docker Local - Guia Completo

## 📋 Objetivo

Criar e testar uma estrutura Docker completa localmente antes de fazer deploy na VPS, garantindo que tudo funcione corretamente.

## 🏗️ Estrutura Criada

### Arquivos

1. **`docker-compose.local.yml`** - Configuração Docker Compose para ambiente local
2. **`scripts/setup-docker-local.sh`** - Script automatizado de setup
3. **`Dockerfile`** - Já existente, otimizado para produção

### Serviços

1. **Redis** (porta 6379)
   - Senha: `leaf_redis_2024`
   - Persistência habilitada
   - Health check configurado

2. **WebSocket Server** (porta 3001)
   - Build a partir do Dockerfile
   - Variáveis de ambiente configuradas
   - Health check configurado
   - Volumes para logs e código

## 🚀 Como Usar

### Setup Inicial

```bash
cd leaf-websocket-backend
./scripts/setup-docker-local.sh
```

### Comandos Manuais

**Iniciar:**
```bash
docker-compose -f docker-compose.local.yml up -d
```

**Ver logs:**
```bash
docker-compose -f docker-compose.local.yml logs -f
```

**Parar:**
```bash
docker-compose -f docker-compose.local.yml down
```

**Reiniciar:**
```bash
docker-compose -f docker-compose.local.yml restart
```

**Testar Redis:**
```bash
docker-compose -f docker-compose.local.yml exec redis redis-cli -a leaf_redis_2024 ping
```

**Testar WebSocket:**
```bash
curl http://localhost:3001/health
```

## ✅ Testes

### 1. Testar Redis

```bash
cd leaf-websocket-backend
node scripts/tests/test-docker-redis.js
```

**Nota:** Ajustar `WS_URL` para `http://localhost:3001` se necessário.

### 2. Testar Eventos

```bash
cd leaf-websocket-backend
WS_URL=http://localhost:3001 node scripts/tests/test-eventos-listeners-completo.js
```

### 3. Testar Diagnóstico

```bash
cd leaf-websocket-backend
WS_URL=http://localhost:3001 node scripts/tests/test-createBooking-diagnostico.js
```

## 🔧 Configurações

### Variáveis de Ambiente

O `docker-compose.local.yml` já configura:
- ✅ `REDIS_HOST=redis` (nome do serviço Docker)
- ✅ `REDIS_PASSWORD=leaf_redis_2024`
- ✅ `REDIS_URL=redis://:leaf_redis_2024@redis:6379/0`
- ✅ `NODE_ENV=development`

### DockerDetector

O código usa `DockerDetector` que:
- Detecta automaticamente se está em Docker
- Retorna `redis` como host quando em Docker
- Retorna `localhost` quando não está em Docker

## 📊 Diferenças: Local vs VPS

| Item | Local (Docker) | VPS (Docker) | VPS (Direto) |
|------|---------------|--------------|--------------|
| Redis Host | `redis` | `redis` | `localhost` |
| Redis Port | `6379` | `6379` | `6379` |
| Redis Password | `leaf_redis_2024` | `leaf_redis_2024` | `leaf_redis_2024` |
| Detecção | Automática | Automática | Automática |

## 🎯 Próximos Passos

1. ✅ **Testar localmente** - Garantir que tudo funciona
2. ⏳ **Ajustar configurações** - Se necessário
3. ⏳ **Criar docker-compose para VPS** - Baseado no local
4. ⏳ **Fazer deploy limpo** - Na VPS com configurações corretas

## 🐛 Troubleshooting

### Redis não conecta

```bash
# Verificar se Redis está rodando
docker-compose -f docker-compose.local.yml ps redis

# Ver logs do Redis
docker-compose -f docker-compose.local.yml logs redis

# Testar conexão manual
docker-compose -f docker-compose.local.yml exec redis redis-cli -a leaf_redis_2024 ping
```

### WebSocket não inicia

```bash
# Ver logs
docker-compose -f docker-compose.local.yml logs websocket

# Verificar variáveis de ambiente
docker-compose -f docker-compose.local.yml config | grep REDIS
```

### Porta já em uso

```bash
# Parar containers
docker-compose -f docker-compose.local.yml down

# Verificar processos usando porta
lsof -i :3001
lsof -i :6379

# Matar processos se necessário
kill -9 <PID>
```

---

**Status**: ✅ Estrutura criada e pronta para testes locais

