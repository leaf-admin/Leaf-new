# 🚀 Guia de Implementação: Alta Disponibilidade e Auto-Escalabilidade

**Tempo estimado:** 1-2 dias  
**Prioridade:** 🔴 CRÍTICA para produção

---

## 📋 Checklist de Implementação

### **FASE 1: Dependências e Configuração Base (2-3 horas)**

#### **1.1. Instalar Dependências**

```bash
cd leaf-websocket-backend
npm install @socket.io/redis-adapter redis
```

#### **1.2. Adicionar Redis Adapter ao server.js**

**Localização:** Após criar `io` (linha ~361)

```javascript
// Após: const io = socketIo(server, { ... });

// ==================== SOCKET.IO REDIS ADAPTER ====================
// Configurar Redis Adapter para escalabilidade horizontal
if (process.env.SOCKET_IO_ADAPTER === 'redis' || process.env.NODE_ENV === 'production') {
    const SocketIORedisAdapter = require('./services/socket-io-adapter');
    const socketAdapter = new SocketIORedisAdapter(process.env.REDIS_URL);
    
    socketAdapter.initialize(io)
        .then(() => {
            console.log('✅ Socket.IO Redis Adapter configurado - Sistema pronto para escalar horizontalmente');
        })
        .catch((error) => {
            console.error('❌ Erro ao configurar Redis Adapter:', error);
            console.warn('⚠️ Sistema continuará funcionando, mas sem escalabilidade horizontal');
        });
} else {
    console.log('ℹ️ Redis Adapter desabilitado (modo desenvolvimento)');
}
// =================================================================
```

#### **1.3. Atualizar Variáveis de Ambiente**

```bash
# .env.production
SOCKET_IO_ADAPTER=redis
REDIS_URL=redis://redis-master:6379
CLUSTER_MODE=true
```

---

### **FASE 2: Docker Compose HA (2-3 horas)**

#### **2.1. Usar docker-compose-ha.yml**

```bash
# Parar instâncias atuais
docker-compose down

# Iniciar com alta disponibilidade
docker-compose -f config/docker/docker-compose-ha.yml up -d

# Verificar status
docker-compose -f config/docker/docker-compose-ha.yml ps
```

#### **2.2. Verificar Health Checks**

```bash
# Verificar Redis
docker exec leaf-redis-master redis-cli ping
docker exec leaf-redis-replica redis-cli ping

# Verificar WebSocket instances
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health

# Verificar Nginx
curl http://localhost/health
```

---

### **FASE 3: Nginx Load Balancer (1-2 horas)**

#### **3.1. Configurar Nginx**

O arquivo `config/nginx/nginx-ha.conf` já está criado e configurado.

#### **3.2. Testar Load Balancing**

```bash
# Testar distribuição de carga
for i in {1..10}; do
  curl -s http://localhost/health | grep -o "websocket_[0-9]"
done

# Deve mostrar diferentes instâncias
```

---

### **FASE 4: Testes e Validação (2-3 horas)**

#### **4.1. Testar Failover**

```bash
# Parar uma instância
docker stop leaf-websocket-1

# Verificar se Nginx detecta e remove do pool
curl http://localhost/health

# Reiniciar instância
docker start leaf-websocket-1

# Verificar se Nginx adiciona de volta
curl http://localhost/health
```

#### **4.2. Testar Escalabilidade**

```bash
# Conectar múltiplos clientes
# Cada cliente deve poder se comunicar via diferentes servidores
# Eventos devem ser propagados entre servidores
```

#### **4.3. Testar Redis Failover**

```bash
# Parar Redis Master
docker stop leaf-redis-master

# Sistema deve continuar funcionando (com degradação)
# Reiniciar Redis Master
docker start leaf-redis-master

# Sistema deve se recuperar automaticamente
```

---

### **FASE 5: Auto-Scaling (Opcional - 4-6 horas)**

#### **5.1. Configurar Auto-Scaler**

```bash
# Instalar como serviço
pm2 start scripts/utils/auto-scaler.js --name leaf-auto-scaler

# Ou executar diretamente
node scripts/utils/auto-scaler.js
```

#### **5.2. Configurar Variáveis de Ambiente**

```bash
# .env
MIN_INSTANCES=2
MAX_INSTANCES=10
SCALE_UP_CPU=70
SCALE_UP_MEMORY=75
SCALE_DOWN_CPU=30
SCALE_DOWN_MEMORY=40
CHECK_INTERVAL=60
SCALE_COOLDOWN=300
```

---

## 🧪 Testes de Validação

### **Teste 1: Múltiplas Instâncias**

```bash
# Conectar 3 clientes simultaneamente
# Cada um deve conectar a uma instância diferente
# Eventos devem ser propagados entre todos
```

### **Teste 2: Failover de Servidor**

```bash
# Conectar cliente
# Parar servidor que cliente está usando
# Cliente deve reconectar automaticamente
# Sistema deve continuar funcionando
```

### **Teste 3: Load Balancing**

```bash
# Fazer 100 requisições
# Verificar distribuição entre servidores
# Deve ser aproximadamente uniforme
```

---

## 📊 Métricas para Monitorar

Após implementação, monitorar:

1. **Distribuição de Conexões**
   - Cada servidor deve ter ~33% das conexões
   - Se desbalanceado, verificar Nginx config

2. **Latência entre Servidores**
   - Eventos devem ser propagados em < 100ms
   - Se maior, verificar Redis latency

3. **Failover Time**
   - Servidor down deve ser detectado em < 30s
   - Clientes devem reconectar em < 60s

4. **Redis Replication Lag**
   - Replica deve estar sincronizada
   - Lag deve ser < 1s

---

## ✅ Critérios de Sucesso

- [ ] 3 instâncias WebSocket rodando
- [ ] Redis Master + Replica funcionando
- [ ] Nginx distribuindo carga
- [ ] Health checks funcionando
- [ ] Failover automático testado
- [ ] Eventos propagados entre servidores
- [ ] Zero downtime em atualizações
- [ ] Auto-scaling configurado (opcional)

---

## 🚨 Troubleshooting

### **Problema: "Session ID unknown"**

**Causa:** Redis Adapter não configurado  
**Solução:** Verificar se `SOCKET_IO_ADAPTER=redis` está configurado

### **Problema: Eventos não propagam**

**Causa:** Redis Adapter não conectado  
**Solução:** Verificar logs do `SocketIORedisAdapter`

### **Problema: Nginx não detecta servidores down**

**Causa:** Health checks não configurados  
**Solução:** Verificar `max_fails` e `fail_timeout` no Nginx

---

**Próximo passo:** Implementar Fase 1 e validar em staging.

