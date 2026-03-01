# 🔍 ANÁLISE COMPLETA: Gargalos de Performance - Leaf App

## 📅 Data: Análise Técnica
## 🎯 Objetivo: Identificar e resolver gargalos críticos de performance
## 📊 Status: **ANÁLISE COMPLETA - PRONTO PARA OTIMIZAÇÃO**

---

## 🚨 **GARGALO 1: BANCO DE DADOS**

### **1.1 Queries Mal Indexadas**

#### **❌ PROBLEMA IDENTIFICADO:**

**Arquivo:** `leaf-websocket-backend/routes/dashboard.js`
**Linha:** 37-38, 124-125, 128-129

```javascript
// ❌ PROBLEMA: Busca TODOS os usuários sem índice
const usersSnapshot = await db.ref('users').once('value');
const users = usersSnapshot.val() || {};

// ❌ PROBLEMA: Busca TODOS os bookings sem índice
const bookingsSnapshot = await db.ref('bookings').once('value');
const bookings = bookingsSnapshot.val() || {};
```

**Impacto:**
- 🔴 **500KB+ de dados** transferidos por query
- 🔴 **Processamento em memória** de todos os registros
- 🔴 **Sem paginação** - busca tudo de uma vez
- 🔴 **Filtros aplicados DEPOIS** de buscar tudo

**Cenário Real:**
- 10.000 usuários = 10.000 registros carregados
- 50.000 bookings = 50.000 registros carregados
- **Total: 60.000 registros em memória por request**

---

#### **❌ PROBLEMA: Queries N+1**

**Arquivo:** `leaf-websocket-backend/graphql/resolvers/UserResolver.js`
**Linha:** 29-70

```javascript
// ❌ PROBLEMA: DataLoader busca TODOS os usuários para cada query
this.userLoader = new DataLoader(async (userIds) => {
    const usersSnapshot = await this.db.ref('users').once('value');
    const users = usersSnapshot.val() || {};
    
    return userIds.map(id => {
        const userData = users[id];
        // ...
    });
});

// ❌ PROBLEMA: DataLoader busca TODOS os bookings para cada query
this.bookingLoader = new DataLoader(async (userIds) => {
    const bookingsSnapshot = await this.db.ref('bookings').once('value');
    const bookings = bookingsSnapshot.val() || {};
    
    return userIds.map(userId => {
        const userBookings = Object.keys(bookings)
            .filter(key => bookings[key].passengerId === userId)
            // ...
    });
});
```

**Impacto:**
- 🔴 **Over-fetching massivo** - busca tudo para filtrar depois
- 🔴 **Sem cache** - cada query busca tudo novamente
- 🔴 **Processamento O(n²)** - filtra em memória para cada usuário

---

#### **❌ PROBLEMA: JOIN Pesado (Simulado em Memória)**

**Arquivo:** `leaf-websocket-backend/routes/dashboard.js`
**Linha:** 133-150

```javascript
// ❌ PROBLEMA: JOIN simulado em memória
users = Object.keys(usersData).map(userId => {
    const user = usersData[userId];
    
    // JOIN com bookings (em memória)
    const userBookings = bookingArray.filter(booking => 
        booking.customer === userId || booking.driver === userId
    );
    
    // Processamento pesado para cada usuário
    const completedBookings = userBookings.filter(booking => 
        booking.status === 'COMPLETE' || booking.status === 'PAID'
    );
    
    const totalSpent = completedBookings.reduce((sum, booking) => 
        sum + parseFloat(booking.customer_paid || 0), 0
    );
    // ...
});
```

**Impacto:**
- 🔴 **Complexidade O(n×m)** - para cada usuário, itera todos os bookings
- 🔴 **10.000 usuários × 50.000 bookings = 500 milhões de comparações**
- 🔴 **Sem índices** - Firebase Realtime DB não tem índices compostos eficientes

---

### **1.2 Escrita Concorrente Sem Controle**

#### **❌ PROBLEMA IDENTIFICADO:**

**Arquivo:** `leaf-websocket-backend/server.js`
**Linha:** 426-438 (saveDriverLocation)

```javascript
// ❌ PROBLEMA: Sem controle de concorrência
await redis.hset(`driver:${driverId}`, {
    lat: lat,
    lng: lng,
    // ... múltiplos campos
});

await redis.geoadd('driver_locations', lng, lat, driverId);
await redis.expire(`driver:${driverId}`, 300);
```

**Impacto:**
- 🔴 **Race conditions** - múltiplas atualizações simultâneas
- 🔴 **Sem transações** - operações não são atômicas
- 🔴 **Sem locks** - escrita concorrente pode corromper dados

**Cenário Real:**
- 1.000 motoristas atualizando localização a cada 5 segundos
- **200 atualizações/segundo** sem controle
- **Risco de dados inconsistentes**

---

### **✅ RECOMENDAÇÕES - BANCO DE DADOS:**

#### **1. Implementar Paginação Real**

```javascript
// ✅ SOLUÇÃO: Paginação com limites
const usersSnapshot = await db.ref('users')
    .orderByChild('createdAt')
    .limitToLast(limit)
    .startAt(lastKey)
    .once('value');
```

#### **2. Criar Índices Compostos**

```javascript
// ✅ SOLUÇÃO: Índices no Firebase
// Criar índices compostos para queries frequentes:
// - users: { userType, status, createdAt }
// - bookings: { passengerId, status, tripdate }
// - bookings: { driverId, status, tripdate }
```

#### **3. Implementar Cache Inteligente**

```javascript
// ✅ SOLUÇÃO: Cache com TTL curto
const cacheKey = `users:${page}:${limit}:${filters}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

const users = await fetchUsersFromDB();
await redis.setex(cacheKey, 60, JSON.stringify(users)); // 1 minuto
```

#### **4. Usar Transações Redis**

```javascript
// ✅ SOLUÇÃO: Transações atômicas
const multi = redis.multi();
multi.hset(`driver:${driverId}`, driverData);
multi.geoadd('driver_locations', lng, lat, driverId);
multi.expire(`driver:${driverId}`, 90);
await multi.exec();
```

#### **5. Implementar Locks Distribuídos**

```javascript
// ✅ SOLUÇÃO: Lock antes de escrever
const lockKey = `lock:driver:${driverId}`;
const lock = await redis.set(lockKey, '1', 'EX', 5, 'NX');
if (lock) {
    try {
        // Atualizar dados
    } finally {
        await redis.del(lockKey);
    }
}
```

---

## 🚨 **GARGALO 2: WEBSOCKET / LONG POLLING**

### **2.1 1.000 Motoristas = 1.000 Conexões Abertas**

#### **❌ PROBLEMA IDENTIFICADO:**

**Arquivo:** `leaf-websocket-backend/server.js`
**Linha:** 818-830

```javascript
// ❌ PROBLEMA: Sem limite de conexões por IP
io.on('connection', async (socket) => {
    console.log(`🔌 [SERVER] NOVA CONEXÃO: ${socket.id}`);
    console.log(`🔌 [SERVER] Total de conexões: ${io.engine.clientsCount}`);
    
    // Sem verificação de limite
    await connectionMonitor.registerConnection(socket.id, null, 'unknown', workerId);
});
```

**Configuração Atual:**
```javascript
const VPS_CONFIG = {
    MAX_CONNECTIONS: 10000, // Limite global
    // ❌ Sem limite por IP
    // ❌ Sem limite por usuário
    // ❌ Sem rate limiting de conexões
};
```

**Impacto:**
- 🔴 **1.000 motoristas = 1.000 conexões WebSocket abertas**
- 🔴 **Cada conexão consome ~50KB de RAM** (buffer + metadata)
- 🔴 **Total: 50MB apenas para conexões** (sem dados)
- 🔴 **Node.js aguenta, mas RAM começa a importar**

**Cenário Real:**
- 1.000 motoristas online = 1.000 conexões
- 10.000 passageiros online = 10.000 conexões
- **Total: 11.000 conexões × 50KB = 550MB apenas para conexões**

---

#### **❌ PROBLEMA: Gerenciamento de Memória**

**Arquivo:** `leaf-websocket-backend/server.js`
**Linha:** 124-125

```javascript
// ❌ PROBLEMA: Map cresce sem limite
const activeConnections = new Map();
const drivers = new Map();
```

**Impacto:**
- 🔴 **Maps crescem indefinidamente** - nunca são limpos
- 🔴 **Memory leak** - conexões desconectadas podem não ser removidas
- 🔴 **Sem garbage collection** - objetos ficam em memória

---

#### **❌ PROBLEMA: Sem Connection Pooling**

**Arquivo:** `leaf-websocket-backend/utils/redis-pool.js`
**Linha:** 13-40

```javascript
// ❌ PROBLEMA: Pool único para todas as conexões
this.pool = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    // ❌ Sem limite de conexões no pool
    // ❌ Sem timeout de conexões ociosas
});
```

**Impacto:**
- 🔴 **Pool pode esgotar** - muitas conexões simultâneas
- 🔴 **Sem reutilização** - cria nova conexão para cada operação
- 🔴 **Overhead de conexão** - estabelecer conexão é caro

---

### **✅ RECOMENDAÇÕES - WEBSOCKET:**

#### **1. Implementar Rate Limiting de Conexões**

```javascript
// ✅ SOLUÇÃO: Limite por IP
const connectionCounts = new Map();
const MAX_CONNECTIONS_PER_IP = 5;

io.use((socket, next) => {
    const ip = socket.handshake.address;
    const count = connectionCounts.get(ip) || 0;
    
    if (count >= MAX_CONNECTIONS_PER_IP) {
        return next(new Error('Too many connections'));
    }
    
    connectionCounts.set(ip, count + 1);
    socket.on('disconnect', () => {
        const newCount = (connectionCounts.get(ip) || 1) - 1;
        connectionCounts.set(ip, Math.max(0, newCount));
    });
    
    next();
});
```

#### **2. Implementar Connection Pooling Inteligente**

```javascript
// ✅ SOLUÇÃO: Pool com limite e timeout
class ConnectionPool {
    constructor(maxSize = 100, idleTimeout = 30000) {
        this.pool = [];
        this.maxSize = maxSize;
        this.idleTimeout = idleTimeout;
    }
    
    async getConnection() {
        // Reutilizar conexão ociosa
        const idle = this.pool.find(c => c.idle);
        if (idle) {
            idle.idle = false;
            return idle.connection;
        }
        
        // Criar nova se não exceder limite
        if (this.pool.length < this.maxSize) {
            const conn = await createConnection();
            this.pool.push({ connection: conn, idle: false });
            return conn;
        }
        
        // Aguardar conexão disponível
        return await this.waitForConnection();
    }
}
```

#### **3. Limpar Conexões Desconectadas**

```javascript
// ✅ SOLUÇÃO: Cleanup automático
socket.on('disconnect', () => {
    // Remover do Map imediatamente
    activeConnections.delete(socket.id);
    drivers.delete(socket.id);
    
    // Limpar dados do Redis
    redis.del(`socket:${socket.id}`);
    
    // Forçar garbage collection (se necessário)
    if (global.gc) {
        global.gc();
    }
});
```

#### **4. Implementar Heartbeat/Keepalive**

```javascript
// ✅ SOLUÇÃO: Detectar conexões mortas
socket.on('ping', () => {
    socket.emit('pong');
    socket.lastPing = Date.now();
});

setInterval(() => {
    const now = Date.now();
    activeConnections.forEach((conn, socketId) => {
        if (now - conn.lastPing > 60000) { // 1 minuto
            const socket = io.sockets.sockets.get(socketId);
            if (socket) socket.disconnect();
        }
    });
}, 30000); // Verificar a cada 30 segundos
```

---

## 🚨 **GARGALO 3: REDIS MAL CONFIGURADO**

### **3.1 TTL Errado**

#### **❌ PROBLEMA IDENTIFICADO:**

**Arquivo:** `leaf-websocket-backend/server.js`
**Linha:** 426-438

```javascript
// ❌ PROBLEMA: TTL muito longo para dados que mudam rápido
await redis.expire(`driver:${driverId}`, 300); // 5 minutos

// ❌ PROBLEMA: TTL muito curto para dados estáticos
await redis.expire(`user:${userId}`, 60); // 1 minuto (dados raramente mudam)
```

**Análise de TTL Atual:**

| Dado | TTL Atual | Frequência de Atualização | Problema |
|------|-----------|---------------------------|----------|
| `driver:${id}` | 300s (5min) | A cada 5s | 🔴 Muito longo - dados antigos ficam no cache |
| `user:${id}` | 60s (1min) | Raramente | 🔴 Muito curto - cache ineficiente |
| `booking:${id}` | Sem TTL | Uma vez | 🔴 Sem TTL - pode crescer indefinidamente |
| `driver_locations` | Sem TTL | A cada 5s | 🔴 Sem TTL - cresce sem limite |

**Impacto:**
- 🔴 **Dados desatualizados** - TTL longo mantém dados antigos
- 🔴 **Cache ineficiente** - TTL curto força re-fetch constante
- 🔴 **Memória desperdiçada** - dados que não expiram

---

### **3.2 Chaves Crescendo Sem Limite**

#### **❌ PROBLEMA IDENTIFICADO:**

**Arquivo:** `leaf-websocket-backend/routes/dashboard.js`
**Linha:** 82

```javascript
// ❌ PROBLEMA: KEYS() bloqueia Redis
const totalBookings = await redis.keys('bookings:*').then(keys => keys.length) || 0;
```

**Impacto:**
- 🔴 **KEYS() bloqueia Redis** - itera todas as chaves
- 🔴 **O(n) onde n = total de chaves** - pode levar segundos
- 🔴 **Sem limite de crescimento** - chaves nunca expiram

**Cenário Real:**
- 50.000 bookings = 50.000 chaves `bookings:*`
- 10.000 usuários = 10.000 chaves `user:*`
- 1.000 motoristas = 1.000 chaves `driver:*`
- **Total: 61.000+ chaves sem TTL**

---

#### **❌ PROBLEMA: Sem maxmemory-policy**

**Arquivo:** `leaf-websocket-backend/redis-config/redis.conf`
**Verificação:** Não encontrado configuração de maxmemory

**Impacto:**
- 🔴 **Redis pode usar toda a RAM disponível**
- 🔴 **Sem política de eviction** - quando RAM acaba, Redis trava
- 🔴 **Sem monitoramento** - não sabemos quando está perto do limite

---

### **✅ RECOMENDAÇÕES - REDIS:**

#### **1. Ajustar TTLs Baseado em Frequência**

```javascript
// ✅ SOLUÇÃO: TTLs otimizados
const TTL_CONFIG = {
    // Dados que mudam rápido - TTL curto
    driverLocation: 90,        // 1.5 min (atualiza a cada 5s)
    driverStatus: 60,           // 1 min (atualiza a cada 5s)
    
    // Dados que mudam raramente - TTL longo
    userProfile: 3600,          // 1 hora
    vehicleInfo: 7200,         // 2 horas
    
    // Dados temporários - TTL muito curto
    rideRequest: 300,          // 5 min (corrida ativa)
    driverLock: 20,            // 20s (lock de corrida)
    
    // Dados históricos - TTL longo
    bookingHistory: 86400,     // 24 horas
    metrics: 2592000,          // 30 dias
};
```

#### **2. Usar SCAN ao Invés de KEYS**

```javascript
// ✅ SOLUÇÃO: SCAN não bloqueia
async function countKeys(pattern) {
    let count = 0;
    let cursor = '0';
    
    do {
        const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        count += result[1].length;
    } while (cursor !== '0');
    
    return count;
}
```

#### **3. Configurar maxmemory-policy**

```conf
# ✅ SOLUÇÃO: Configurar Redis
maxmemory 2gb
maxmemory-policy allkeys-lru  # Remove chaves menos usadas quando RAM acaba
```

#### **4. Implementar Limpeza Automática**

```javascript
// ✅ SOLUÇÃO: Limpeza periódica de chaves expiradas
setInterval(async () => {
    // Limpar chaves antigas
    const patterns = [
        'ride_request:*',      // Corridas antigas
        'driver_lock:*',       // Locks expirados
        'temp:*',              // Dados temporários
    ];
    
    for (const pattern of patterns) {
        const keys = await scanKeys(pattern);
        for (const key of keys) {
            const ttl = await redis.ttl(key);
            if (ttl === -1) { // Sem TTL
                await redis.expire(key, 3600); // Adicionar TTL padrão
            }
        }
    }
}, 3600000); // A cada hora
```

#### **5. Monitorar Uso de Memória**

```javascript
// ✅ SOLUÇÃO: Monitoramento contínuo
setInterval(async () => {
    const info = await redis.info('memory');
    const usedMemory = parseInt(info.match(/used_memory:(\d+)/)[1]);
    const maxMemory = parseInt(info.match(/maxmemory:(\d+)/)[1]);
    
    const usagePercent = (usedMemory / maxMemory) * 100;
    
    if (usagePercent > 80) {
        console.warn(`⚠️ Redis memory usage: ${usagePercent.toFixed(2)}%`);
        // Alertar ou limpar cache
    }
}, 60000); // A cada minuto
```

---

## 📊 **RESUMO DOS GARGALOS**

### **Prioridade CRÍTICA (Resolver Imediatamente):**

1. 🔴 **KEYS() bloqueando Redis** - Usar SCAN
2. 🔴 **Queries sem paginação** - Implementar limites
3. 🔴 **Sem maxmemory-policy** - Configurar Redis
4. 🔴 **TTLs incorretos** - Ajustar baseado em frequência

### **Prioridade ALTA (Resolver em 1-2 semanas):**

5. 🟠 **Queries N+1** - Otimizar DataLoaders
6. 🟠 **JOIN em memória** - Mover para banco ou cache
7. 🟠 **Sem rate limiting de conexões** - Implementar limites
8. 🟠 **Memory leaks** - Limpar conexões desconectadas

### **Prioridade MÉDIA (Resolver em 1 mês):**

9. 🟡 **Sem índices compostos** - Criar índices no Firebase
10. 🟡 **Sem transações Redis** - Implementar MULTI/EXEC
11. 🟡 **Sem connection pooling** - Implementar pool inteligente

---

## 🎯 **PLANO DE AÇÃO**

### **Fase 1: Correções Críticas (1 semana)**
- [ ] Substituir KEYS() por SCAN
- [ ] Configurar maxmemory-policy no Redis
- [ ] Ajustar TTLs baseado em frequência
- [ ] Implementar paginação em todas as queries

### **Fase 2: Otimizações de Performance (2 semanas)**
- [ ] Otimizar DataLoaders (buscar apenas campos necessários)
- [ ] Implementar cache inteligente com TTL correto
- [ ] Implementar rate limiting de conexões
- [ ] Limpar conexões desconectadas automaticamente

### **Fase 3: Melhorias de Arquitetura (1 mês)**
- [ ] Criar índices compostos no Firebase
- [ ] Implementar transações Redis para escritas críticas
- [ ] Implementar connection pooling
- [ ] Adicionar monitoramento de memória e performance

---

## 📈 **MÉTRICAS DE SUCESSO**

### **Antes das Otimizações:**
- ⏱️ Query de dashboard: **2-5 segundos**
- 💾 Uso de RAM Redis: **Sem limite**
- 🔌 Conexões WebSocket: **Sem controle**
- 📊 Queries N+1: **Frequentes**

### **Depois das Otimizações:**
- ⏱️ Query de dashboard: **<500ms** (meta)
- 💾 Uso de RAM Redis: **<80% do limite** (meta)
- 🔌 Conexões WebSocket: **Limitadas e monitoradas** (meta)
- 📊 Queries N+1: **Eliminadas** (meta)

---

## 🔗 **REFERÊNCIAS**

- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
- [Socket.IO Performance](https://socket.io/docs/v4/performance-tuning/)
- [Firebase Realtime DB Indexing](https://firebase.google.com/docs/database/usage/optimize)
- [Node.js Memory Management](https://nodejs.org/en/docs/guides/simple-profiling/)

---

**Última atualização:** Análise completa dos gargalos identificados
**Próximos passos:** Implementar correções da Fase 1

