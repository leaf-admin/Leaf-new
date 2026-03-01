# 🚀 Estudo: Auto-Escalabilidade e Alta Disponibilidade - LEAF MVP

**Data:** 2025-01-XX  
**Objetivo:** Garantir SLA de 99.9% de disponibilidade e capacidade de auto-escalar

---

## 📊 Situação Atual vs. Necessária

### **Situação Atual**

| Componente | Status | Limitação |
|------------|--------|-----------|
| Servidor WebSocket | ✅ Funcional | 1 instância (cluster desabilitado) |
| Redis | ✅ Funcional | Standalone (sem replicação) |
| Load Balancer | ❌ Não configurado | Sem distribuição de carga |
| Socket.IO Adapter | ❌ Não implementado | Não escala horizontalmente |
| Health Checks | ✅ Implementado | Básico (sem auto-healing) |
| Auto-Scaling | ❌ Não implementado | Escala manual |

### **Necessário para SLA 99.9%**

| Componente | Necessário | Impacto no SLA |
|------------|------------|----------------|
| Múltiplos Servidores | ✅ 2+ instâncias | Reduz downtime de 100% para ~0.1% |
| Redis Replica | ✅ Master + 1 Replica | Reduz downtime de Redis de 100% para ~0.01% |
| Load Balancer | ✅ Nginx/HAProxy | Distribui carga e detecta falhas |
| Socket.IO Redis Adapter | ✅ Obrigatório | Permite múltiplos servidores |
| Health Checks Avançados | ✅ Com auto-healing | Recuperação automática |
| Auto-Scaling | ✅ Baseado em métricas | Escala sob demanda |

---

## 🔴 Bloqueadores Atuais

### **1. Socket.IO sem Redis Adapter**

**Problema:**
- Cluster mode desabilitado por causa de "Session ID unknown"
- Socket.IO não compartilha estado entre servidores
- Conexões ficam presas a um servidor específico

**Impacto:**
- ❌ Não pode ter múltiplos servidores
- ❌ Se servidor cair, todas as conexões são perdidas
- ❌ Não escala horizontalmente

**Solução:**
```javascript
// Instalar: npm install @socket.io/redis-adapter
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));
```

**Esforço:** 🟢 BAIXO (2-3 horas)

---

### **2. Redis Standalone**

**Problema:**
- Single point of failure
- Sem backup automático
- Sem failover

**Impacto:**
- ❌ Se Redis cair, sistema inteiro para
- ❌ Perda de dados em memória
- ❌ Sem recuperação automática

**Solução:**
```yaml
# docker-compose.yml
redis-master:
  image: redis:7-alpine
  command: redis-server --appendonly yes
  
redis-replica:
  image: redis:7-alpine
  command: redis-server --slaveof redis-master 6379
```

**Esforço:** 🟡 MÉDIO (4-6 horas)

---

### **3. Sem Load Balancer**

**Problema:**
- Não distribui carga entre servidores
- Não detecta servidores down
- Sem health checks automáticos

**Impacto:**
- ❌ Carga concentrada em um servidor
- ❌ Falhas não são detectadas automaticamente
- ❌ Sem failover automático

**Solução:**
```nginx
upstream websocket_backend {
    least_conn;
    server websocket-1:3001 max_fails=3 fail_timeout=30s;
    server websocket-2:3001 max_fails=3 fail_timeout=30s;
    server websocket-3:3001 max_fails=3 fail_timeout=30s backup;
}
```

**Esforço:** 🟡 MÉDIO (3-4 horas)

---

### **4. Sem Auto-Scaling**

**Problema:**
- Escala manual
- Não responde a picos de demanda
- Pode perder SLA durante picos

**Impacto:**
- ❌ Sobrecarga durante picos
- ❌ Perda de requisições
- ❌ SLA comprometido

**Solução:**
- Docker Swarm ou Kubernetes
- Métricas baseadas em CPU/Memória/Conexões
- Auto-scaling policies

**Esforço:** 🔴 ALTO (1-2 semanas)

---

## ✅ Plano de Implementação

### **FASE 1: Fundação (Crítico - 1 dia)**

#### **1.1. Implementar Redis Adapter para Socket.IO**

**Arquivo:** `server.js`

```javascript
// Adicionar após criar io
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

// Criar clientes Redis para adapter
const pubClient = createClient({ 
    url: process.env.REDIS_URL || 'redis://localhost:6379' 
});
const subClient = pubClient.duplicate();

// Conectar clientes
await Promise.all([pubClient.connect(), subClient.connect()]);

// Configurar adapter
io.adapter(createAdapter(pubClient, subClient));

console.log('✅ Socket.IO Redis Adapter configurado');
```

**Dependência:** `npm install @socket.io/redis-adapter redis`

**Benefícios:**
- ✅ Múltiplos servidores podem compartilhar conexões
- ✅ Cluster mode pode ser reativado
- ✅ Escala horizontalmente

---

#### **1.2. Configurar Redis Replica**

**Arquivo:** `config/docker/docker-compose-ha.yml` (novo)

```yaml
version: '3.8'

services:
  redis-master:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 1gb
    volumes:
      - redis-master-data:/data
    networks:
      - leaf-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  redis-replica:
    image: redis:7-alpine
    command: redis-server --slaveof redis-master 6379 --maxmemory 1gb
    volumes:
      - redis-replica-data:/data
    networks:
      - leaf-network
    restart: unless-stopped
    depends_on:
      redis-master:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

volumes:
  redis-master-data:
  redis-replica-data:

networks:
  leaf-network:
    driver: bridge
```

**Benefícios:**
- ✅ Failover automático se master cair
- ✅ Backup automático (replica)
- ✅ Leitura distribuída (opcional)

---

#### **1.3. Configurar Load Balancer Nginx**

**Arquivo:** `config/nginx/nginx-ha.conf` (novo)

```nginx
upstream websocket_backend {
    # Load balancing com least_conn (menos conexões)
    least_conn;
    
    # Servidores principais
    server websocket-1:3001 max_fails=3 fail_timeout=30s;
    server websocket-2:3001 max_fails=3 fail_timeout=30s;
    server websocket-3:3001 max_fails=3 fail_timeout=30s;
    
    # Servidor de backup (só usado se todos principais falharem)
    server websocket-backup:3001 backup;
    
    # Health check
    keepalive 32;
}

server {
    listen 80;
    server_name socket.leaf.app.br;
    
    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
    
    # WebSocket upgrade
    location / {
        proxy_pass http://websocket_backend;
        proxy_http_version 1.1;
        
        # WebSocket headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts para WebSocket
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffer settings
        proxy_buffering off;
    }
}
```

**Benefícios:**
- ✅ Distribui carga automaticamente
- ✅ Detecta servidores down
- ✅ Failover automático

---

### **FASE 2: Alta Disponibilidade (Crítico - 2 dias)**

#### **2.1. Docker Compose com Múltiplas Instâncias**

**Arquivo:** `config/docker/docker-compose-ha.yml`

```yaml
version: '3.8'

services:
  # Redis Master + Replica (já definido acima)
  
  # Nginx Load Balancer
  nginx:
    image: nginx:alpine
    volumes:
      - ./config/nginx/nginx-ha.conf:/etc/nginx/nginx.conf
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - websocket-1
      - websocket-2
      - websocket-3
    restart: unless-stopped

  # WebSocket Instance 1
  websocket-1:
    build: .
    environment:
      - NODE_ENV=production
      - PORT=3001
      - INSTANCE_ID=websocket_1
      - REDIS_URL=redis://redis-master:6379
      - SOCKET_IO_ADAPTER=redis
    depends_on:
      - redis-master
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # WebSocket Instance 2
  websocket-2:
    build: .
    environment:
      - NODE_ENV=production
      - PORT=3001
      - INSTANCE_ID=websocket_2
      - REDIS_URL=redis://redis-master:6379
      - SOCKET_IO_ADAPTER=redis
    depends_on:
      - redis-master
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # WebSocket Instance 3
  websocket-3:
    build: .
    environment:
      - NODE_ENV=production
      - PORT=3001
      - INSTANCE_ID=websocket_3
      - REDIS_URL=redis://redis-master:6379
      - SOCKET_IO_ADAPTER=redis
    depends_on:
      - redis-master
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3
```

**Benefícios:**
- ✅ 3 instâncias redundantes
- ✅ Auto-restart em caso de falha
- ✅ Health checks automáticos

---

#### **2.2. Health Checks Avançados**

**Arquivo:** `services/health-check-service.js` (novo)

```javascript
class HealthCheckService {
    constructor(io) {
        this.io = io;
        this.checks = {
            redis: this.checkRedis.bind(this),
            firebase: this.checkFirebase.bind(this),
            websocket: this.checkWebSocket.bind(this),
            system: this.checkSystem.bind(this)
        };
    }

    async checkRedis() {
        const redis = require('../utils/redis-pool').getConnection();
        try {
            await redis.ping();
            return { status: 'healthy', latency: Date.now() - start };
        } catch (error) {
            return { status: 'unhealthy', error: error.message };
        }
    }

    async getHealthStatus() {
        const results = {};
        for (const [name, check] of Object.entries(this.checks)) {
            results[name] = await check();
        }
        
        const overall = Object.values(results).every(r => r.status === 'healthy')
            ? 'healthy' : 'degraded';
        
        return { overall, checks: results };
    }
}
```

**Benefícios:**
- ✅ Monitora todos os componentes
- ✅ Detecta problemas antes que afetem usuários
- ✅ Pode ser usado para auto-scaling

---

### **FASE 3: Auto-Scaling (Opcional - 1 semana)**

#### **3.1. Docker Swarm (Recomendado para MVP)**

**Arquivo:** `config/docker/docker-stack.yml`

```yaml
version: '3.8'

services:
  websocket:
    image: leaf-websocket-backend:latest
    deploy:
      replicas: 2
      update_config:
        parallelism: 1
        delay: 10s
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis-master:6379
    networks:
      - leaf-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3
```

**Comandos:**
```bash
# Inicializar swarm
docker swarm init

# Deploy stack
docker stack deploy -c config/docker/docker-stack.yml leaf

# Escalar manualmente
docker service scale leaf_websocket=3

# Ver status
docker service ls
docker service ps leaf_websocket
```

**Benefícios:**
- ✅ Escala horizontalmente
- ✅ Auto-restart de containers
- ✅ Rolling updates sem downtime

---

#### **3.2. Auto-Scaling Baseado em Métricas**

**Arquivo:** `scripts/utils/auto-scaler.js` (novo)

```javascript
class AutoScaler {
    constructor() {
        this.minInstances = 2;
        this.maxInstances = 10;
        this.scaleUpThreshold = {
            cpu: 70,
            memory: 75,
            connections: 8000
        };
        this.scaleDownThreshold = {
            cpu: 30,
            memory: 40,
            connections: 2000
        };
    }

    async checkAndScale() {
        const metrics = await this.getMetrics();
        
        // Verificar se precisa escalar para cima
        if (this.shouldScaleUp(metrics)) {
            await this.scaleUp();
        }
        
        // Verificar se precisa escalar para baixo
        if (this.shouldScaleDown(metrics)) {
            await this.scaleDown();
        }
    }

    async scaleUp() {
        const current = await this.getCurrentInstances();
        if (current < this.maxInstances) {
            await this.addInstance();
        }
    }
}
```

**Integração com Docker Swarm:**
```bash
# Script de auto-scaling
#!/bin/bash
CPU=$(docker stats --no-stream --format "{{.CPUPerc}}" leaf_websocket | sed 's/%//')
if (( $(echo "$CPU > 70" | bc -l) )); then
    docker service scale leaf_websocket=+1
fi
```

---

## 📊 Arquitetura Proposta

### **Arquitetura de Alta Disponibilidade**

```
                    ┌─────────────┐
                    │   Nginx LB  │
                    │  (Load Bal) │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐        ┌────▼────┐        ┌────▼────┐
   │   WS-1  │        │   WS-2  │        │   WS-3  │
   │ :3001   │        │ :3001   │        │ :3001   │
   └────┬────┘        └────┬────┘        └────┬────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐        ┌────▼────┐        ┌────▼────┐
   │Redis    │◄───────┤Redis    │        │Firebase │
   │Master   │        │Replica  │        │         │
   └─────────┘        └─────────┘        └─────────┘
```

### **Fluxo de Conexão**

1. Cliente conecta → Nginx Load Balancer
2. Nginx escolhe servidor (least_conn)
3. Servidor cria conexão WebSocket
4. Socket.IO usa Redis Adapter para compartilhar estado
5. Eventos são propagados via Redis Pub/Sub

---

## 🎯 SLA e Disponibilidade

### **Cálculo de Disponibilidade**

**Cenário 1: Servidor Único**
- Disponibilidade servidor: 99.5% (4h downtime/mês)
- Disponibilidade Redis: 99.5%
- **Disponibilidade Total: 99.0%** (7.2h downtime/mês)
- **SLA: ❌ NÃO ATENDE 99.9%**

**Cenário 2: 3 Servidores + Redis Replica**
- Disponibilidade servidor: 99.5% cada
- Disponibilidade com 3 servidores: 99.999% (redundância)
- Disponibilidade Redis: 99.99% (master + replica)
- **Disponibilidade Total: 99.989%** (~5min downtime/mês)
- **SLA: ✅ ATENDE 99.9%**

---

## ⚡ Implementação Rápida (1-2 dias)

### **Checklist de Implementação**

#### **Dia 1: Fundação**

- [ ] **Manhã (4h)**
  - [ ] Instalar `@socket.io/redis-adapter`
  - [ ] Implementar Redis Adapter no `server.js`
  - [ ] Testar múltiplas instâncias localmente
  - [ ] Reativar cluster mode

- [ ] **Tarde (4h)**
  - [ ] Configurar Redis Replica no Docker
  - [ ] Testar failover de Redis
  - [ ] Configurar Nginx Load Balancer
  - [ ] Testar distribuição de carga

#### **Dia 2: Produção**

- [ ] **Manhã (4h)**
  - [ ] Deploy de 3 instâncias em produção
  - [ ] Configurar Nginx em produção
  - [ ] Testar failover de servidores
  - [ ] Monitorar métricas

- [ ] **Tarde (4h)**
  - [ ] Configurar health checks avançados
  - [ ] Configurar alertas para falhas
  - [ ] Documentar procedimentos
  - [ ] Testes de carga

---

## 🔧 Configurações Necessárias

### **1. Variáveis de Ambiente**

```bash
# .env.production
NODE_ENV=production
PORT=3001

# Redis
REDIS_URL=redis://redis-master:6379
REDIS_REPLICA_URL=redis://redis-replica:6379
REDIS_MODE=replica

# Socket.IO
SOCKET_IO_ADAPTER=redis
CLUSTER_MODE=true

# Instância
INSTANCE_ID=websocket_1
```

### **2. Dependências**

```json
{
  "dependencies": {
    "@socket.io/redis-adapter": "^8.2.0",
    "redis": "^4.6.10"
  }
}
```

### **3. Docker Compose**

Usar `config/docker/docker-compose-ha.yml` (criar)

---

## 📈 Capacidade Esperada

### **Antes (1 servidor)**
- **Usuários simultâneos:** ~1.000
- **Conexões máx:** 10.000
- **Disponibilidade:** 99.0%
- **Downtime/mês:** ~7.2 horas

### **Depois (3 servidores + HA)**
- **Usuários simultâneos:** ~15.000
- **Conexões máx:** 30.000 (3x)
- **Disponibilidade:** 99.989%
- **Downtime/mês:** ~5 minutos

---

## 🚨 Pontos de Atenção

### **1. Sticky Sessions (NÃO necessário com Redis Adapter)**

**Mito:** Precisa de sticky sessions para WebSocket  
**Realidade:** Com Redis Adapter, Socket.IO gerencia estado centralmente

**Solução:** Redis Adapter elimina necessidade de sticky sessions

---

### **2. Race Conditions**

**Problema:** Múltiplos workers processando mesma fila

**Solução:** Já implementado com `DriverLockManager`

---

### **3. Eventos Duplicados**

**Problema:** Eventos podem ser processados múltiplas vezes

**Solução:** Idempotência nos handlers (já implementado)

---

## ✅ Conclusão

### **É Possível Implementar em 1-2 Dias**

**Fase 1 (Crítico):**
- ✅ Redis Adapter: 2-3 horas
- ✅ Redis Replica: 4-6 horas
- ✅ Nginx Load Balancer: 3-4 horas
- **Total: 1 dia**

**Fase 2 (Recomendado):**
- ✅ Múltiplas instâncias: 2-3 horas
- ✅ Health checks avançados: 2-3 horas
- ✅ Testes e ajustes: 4-6 horas
- **Total: 1 dia**

**Resultado:**
- ✅ SLA 99.9% garantido
- ✅ Auto-escalabilidade básica
- ✅ Alta disponibilidade
- ✅ Zero downtime em atualizações

---

**Próximo passo:** Implementar Fase 1 e validar em ambiente de staging.

