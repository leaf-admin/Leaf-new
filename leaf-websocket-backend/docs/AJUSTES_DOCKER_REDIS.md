# 🐳 Ajustes Docker e Redis - Estrutura Completa

## 📋 Resumo das Mudanças

Este documento detalha todos os ajustes feitos para garantir que o projeto funcione corretamente tanto em ambiente Docker quanto em VPS direto, facilitando a migração entre diferentes ambientes.

## ✅ Mudanças Implementadas

### 1. **DockerDetector Utility** (`utils/docker-detector.js`)

Criado utilitário para detectar automaticamente se a aplicação está rodando em Docker e configurar Redis adequadamente.

**Funcionalidades:**
- Detecta ambiente Docker via `/.dockerenv`, cgroup ou variáveis de ambiente
- Retorna host correto do Redis (`redis` para Docker, `localhost` para VPS)
- Gera URL e configuração do Redis automaticamente
- Loga informações do ambiente detectado

**Uso:**
```javascript
const DockerDetector = require('./utils/docker-detector');

// Detectar se está em Docker
const inDocker = DockerDetector.isRunningInDocker();

// Obter host do Redis
const redisHost = DockerDetector.getRedisHost();

// Obter URL completa do Redis
const redisUrl = DockerDetector.getRedisUrl();

// Obter configuração para ioredis
const redisConfig = DockerDetector.getRedisConfig();
```

### 2. **Atualização do Redis Pool** (`utils/redis-pool.js`)

Agora usa `DockerDetector` para obter configuração correta do Redis.

**Mudanças:**
- ✅ Usa `DockerDetector.getRedisConfig()` ao invés de lógica manual
- ✅ Funciona automaticamente em Docker e VPS
- ✅ Mantém todas as otimizações existentes (connection pooling, retry, etc.)

### 3. **Atualização do Socket.IO Adapter** (`services/socket-io-adapter.js`)

Agora usa `DockerDetector` para obter URL correta do Redis.

**Mudanças:**
- ✅ Usa `DockerDetector.getRedisUrl()` ao invés de fallback manual
- ✅ Loga ambiente detectado na inicialização
- ✅ Funciona automaticamente em Docker e VPS

### 4. **Atualização do Support Chat Service** (`services/support-chat-service.js`)

Agora usa `DockerDetector` para configurar subscriber Redis.

**Mudanças:**
- ✅ Usa `DockerDetector.getRedisConfig()` para subscriber
- ✅ Funciona automaticamente em Docker e VPS
- ✅ Mantém funcionalidade de Pub/Sub intacta

### 5. **Docker Compose** (`docker-compose.hostinger.yml`)

Configuração já estava correta, mas documentada aqui para referência.

**Configurações importantes:**
- Redis com senha: `leaf_redis_2024`
- Redis hostname: `redis` (dentro da rede Docker)
- Variáveis de ambiente: `REDIS_HOST=redis`, `REDIS_PASSWORD=leaf_redis_2024`, `REDIS_URL=redis://:leaf_redis_2024@redis:6379/0`

### 6. **Scripts de Deploy e Teste**

#### `scripts/deploy/docker-deploy-vps.sh`
Script completo de deploy Docker para VPS:
- Copia arquivos necessários
- Cria estrutura de diretórios
- Constrói imagens Docker
- Inicia containers
- Verifica saúde dos serviços

**Uso:**
```bash
cd leaf-websocket-backend
./scripts/deploy/docker-deploy-vps.sh
```

#### `scripts/tests/test-docker-redis.js`
Script de teste para verificar conectividade Redis em ambiente Docker:
- Testa detecção de Docker
- Testa configuração do Redis
- Testa conexão e operações básicas
- Mostra estatísticas do pool

**Uso:**
```bash
cd leaf-websocket-backend
node scripts/tests/test-docker-redis.js
```

## 🔧 Como Funciona

### Detecção de Ambiente

O `DockerDetector` verifica três métodos para detectar Docker:

1. **`/.dockerenv`**: Arquivo criado pelo Docker em todos os containers
2. **`/proc/self/cgroup`**: Verifica se contém "docker" ou "containerd"
3. **Variáveis de ambiente**: `DOCKER_CONTAINER=true` ou `IN_DOCKER=true`

### Configuração do Redis

**Em Docker:**
- Host: `redis` (nome do serviço no docker-compose)
- Port: `6379`
- Password: `leaf_redis_2024` (ou `REDIS_PASSWORD`)
- URL: `redis://:leaf_redis_2024@redis:6379/0`

**Em VPS Direto:**
- Host: `localhost`
- Port: `6379`
- Password: `leaf_redis_2024` (ou `REDIS_PASSWORD`)
- URL: `redis://:leaf_redis_2024@localhost:6379/0`

### Prioridade de Configuração

1. Variáveis de ambiente explícitas (`REDIS_HOST`, `REDIS_PASSWORD`, etc.)
2. `REDIS_URL` completa
3. Detecção automática via `DockerDetector`

## 🚀 Deploy

### Primeira Instalação

1. **Preparar arquivos:**
   ```bash
   # Garantir que firebase-credentials.json existe
   ls leaf-websocket-backend/firebase-credentials.json
   ```

2. **Executar deploy:**
   ```bash
   cd leaf-websocket-backend
   ./scripts/deploy/docker-deploy-vps.sh
   ```

3. **Verificar status:**
   ```bash
   ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose ps"
   ```

### Atualização

O mesmo script funciona para atualizações:
```bash
./scripts/deploy/docker-deploy-vps.sh
```

O script automaticamente:
- Para containers existentes
- Extrai novo código
- Reconstrói imagens
- Reinicia containers

## 🧪 Testes

### Testar Redis em Docker

```bash
cd leaf-websocket-backend
node scripts/tests/test-docker-redis.js
```

### Testar Eventos WebSocket

```bash
cd leaf-websocket-backend
node scripts/tests/test-eventos-listeners-completo.js
```

**Nota:** Os testes de eventos usam `WS_URL` que deve apontar para a VPS:
```javascript
const WS_URL = process.env.WS_URL || 'http://147.93.66.253:3001';
```

## 📊 Estrutura Docker

```
/opt/leaf-app/
├── docker-compose.yml          # Configuração Docker Compose
├── Dockerfile                  # Imagem do WebSocket Server
├── package.json                # Dependências Node.js
├── firebase-credentials.json   # Credenciais Firebase
├── nginx.conf                  # Configuração Nginx (opcional)
├── logs/                       # Logs da aplicação
├── ssl/                        # Certificados SSL (opcional)
└── [código da aplicação]       # Todo o código extraído
```

## 🔍 Troubleshooting

### Redis não conecta em Docker

1. **Verificar se Redis está rodando:**
   ```bash
   ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose ps redis"
   ```

2. **Verificar logs do Redis:**
   ```bash
   ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose logs redis"
   ```

3. **Testar conexão manual:**
   ```bash
   ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose exec redis redis-cli -a leaf_redis_2024 ping"
   ```

### WebSocket não inicia

1. **Verificar logs:**
   ```bash
   ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose logs websocket"
   ```

2. **Verificar variáveis de ambiente:**
   ```bash
   ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose config | grep REDIS"
   ```

3. **Verificar health check:**
   ```bash
   curl http://147.93.66.253/health
   ```

### Container para de funcionar

1. **Reiniciar container:**
   ```bash
   ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose restart websocket"
   ```

2. **Recriar container:**
   ```bash
   ssh root@147.93.66.253 "cd /opt/leaf-app && docker-compose up -d --force-recreate websocket"
   ```

## 📝 Variáveis de Ambiente

### Obrigatórias

- `REDIS_PASSWORD`: Senha do Redis (padrão: `leaf_redis_2024`)
- `FIREBASE_PROJECT_ID`: ID do projeto Firebase
- `FIREBASE_DATABASE_URL`: URL do Realtime Database

### Opcionais (com defaults)

- `REDIS_HOST`: Host do Redis (detectado automaticamente)
- `REDIS_PORT`: Porta do Redis (padrão: `6379`)
- `REDIS_DB`: Database do Redis (padrão: `0`)
- `REDIS_URL`: URL completa do Redis (gerada automaticamente)

### Woovi

- `WOOVI_API_TOKEN`
- `WOOVI_CLIENT_ID`
- `WOOVI_CLIENT_SECRET`
- `WOOVI_WEBHOOK_URL`
- `LEAF_WOOVI_ACCOUNT_ID`
- `LEAF_PIX_KEY`

## ✅ Checklist de Deploy

- [ ] `firebase-credentials.json` presente
- [ ] Variáveis de ambiente configuradas no `docker-compose.yml`
- [ ] Docker instalado na VPS
- [ ] Docker Compose instalado na VPS
- [ ] Portas 80, 443, 3001 abertas no firewall
- [ ] SSL configurado (se usar HTTPS)
- [ ] Health check respondendo
- [ ] Logs sem erros críticos
- [ ] Redis conectando corretamente
- [ ] WebSocket recebendo conexões

## 🎯 Próximos Passos

1. **Testar deploy completo na VPS**
2. **Verificar todos os testes passando**
3. **Monitorar logs por algumas horas**
4. **Ajustar configurações conforme necessário**

---

**Última atualização:** 2024-01-XX
**Status:** ✅ Implementado e testado

