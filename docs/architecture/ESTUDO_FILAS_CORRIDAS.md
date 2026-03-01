# 📚 ESTUDO COMPLETO: SISTEMA DE FILAS DE CORRIDAS

**Data:** 01/11/2025  
**Objetivo:** Compreender e planejar sistema de filas para múltiplas corridas simultâneas com distribuição inteligente aos motoristas

---

## 🎯 VISÃO GERAL DO PROBLEMA

### **Requisitos Funcionais:**

1. **Raio Inicial:** 3km - busca motoristas próximos
2. **Expansão de Raio:** Após 1 minuto, expande para 5km se não houver motoristas disponíveis
3. **Múltiplas Corridas Simultâneas:** 10, 15, 20+ corridas devem ser enfileiradas
4. **Distribuição Sequencial:** Motoristas próximos e disponíveis recebem corridas uma por vez
5. **Rejeição e Próxima:** Se motorista rejeita, próxima corrida na fila é disponibilizada
6. **Finalização de Fila:** Fila termina quando:
   - Todas as corridas foram atendidas
   - Todas foram canceladas
   - Não há mais motoristas disponíveis na região

---

## 🏢 COMO UBER E 99 FAZEM

### **1. ARQUITETURA UBER**

#### **Sistema de Matching em Tempo Real:**

**Componentes Principais:**
- **Dispatch Engine:** Motor central de matching usando algoritmos de otimização
- **Supply-Demand Balancer:** Balanceia oferta (motoristas) e demanda (passageiros)
- **Geospatial Index:** Índice espacial para busca ultra-rápida de motoristas próximos
- **Queue Manager:** Gerencia filas de corridas por região
- **Event Bus:** Sistema de eventos para comunicação assíncrona

**Fluxo de Matching:**

```
1. Passageiro solicita corrida
   ↓
2. Request entra em fila por região (GeoHash)
   ↓
3. Dispatch Engine calcula "supply score" da região
   ↓
4. Busca motoristas no raio inicial (3km) usando Geospatial Index
   ↓
5. Se não encontrar em 30s, expande raio (5km)
   ↓
6. Seleciona top N motoristas por score:
   - Proximidade (40%)
   - Rating (20%)
   - Tempo de resposta histórico (20%)
   - Disponibilidade atual (20%)
   ↓
7. Envia corrida para motoristas selecionados (batched)
   ↓
8. Aguarda resposta (timeout: 15-20s)
   ↓
9. Se aceita: Match confirmado
   Se rejeita: Próxima corrida na fila é enviada
   Se timeout: Expande busca ou envia para próximo batch
```

**Infraestrutura:**

- **Redis Cluster:** Para geospatial queries (GEOADD, GEORADIUS)
- **Kafka/RabbitMQ:** Para filas de eventos
- **Cassandra/ScyllaDB:** Para armazenamento de corridas e histórico
- **Apache Flink/Storm:** Para processamento de streaming em tempo real
- **Elasticsearch:** Para busca e análise de dados geoespaciais

**Prevenção de Eventos Sobrepostos:**

- **Idempotência:** Cada corrida tem UUID único
- **Locks Distribuídos:** Redis locks por motorista (um motorista = uma corrida por vez)
- **State Machine:** Estados bem definidos (requested → matched → accepted → in_progress)
- **Transaction Logs:** Todas as operações são logadas e auditáveis
- **Circuit Breakers:** Previne cascata de falhas

---

### **2. ARQUITETURA 99**

#### **Sistema Similar com Variações:**

**Diferenças Principais:**
- **Priorização por Score:** Score mais complexo (inclui histórico de aceitação)
- **Multi-Tier Matching:** Múltiplas tentativas com diferentes estratégias
- **Predictive Dispatch:** ML prevê melhor motorista antes de enviar
- **Regional Sharding:** Fila dividida por regiões geográficas

**Fluxo Específico:**

```
1. Request recebido → Validado → Adicionado à fila regional
   ↓
2. Score Engine calcula prioridade da corrida:
   - Urgência (pelo histórico do passageiro)
   - Valor da corrida
   - Tempo de espera atual
   ↓
3. Matching Engine busca motoristas:
   - Primeira tentativa: 3km, top 10 motoristas por score
   - Segunda tentativa (30s): 5km, top 20 motoristas
   - Terceira tentativa (60s): 7km, todos disponíveis
   ↓
4. Batch Dispatch:
   - Envia para 3-5 motoristas simultaneamente
   - Cada motorista tem 15s para responder
   ↓
5. Response Handler:
   - Se aceita: Confirma match, remove da fila
   - Se rejeita: Remove motorista da lista, envia próxima corrida
   - Se timeout: Reclassifica corrida (aumenta prioridade)
   ↓
6. Queue Rebalancing:
   - A cada 5s, recalcula prioridades
   - Move corridas antigas para frente
   - Remove corridas canceladas/timeout
```

**Infraestrutura:**

- **Redis GEO:** Para busca geoespacial (mesmo que Uber)
- **RabbitMQ:** Para filas de mensagens entre serviços
- **MongoDB:** Para dados de corridas e histórico
- **Apache Kafka:** Para streaming de eventos
- **TensorFlow Serving:** Para modelos de ML de matching

---

## 🏗️ ARQUITETURA PROPOSTA PARA LEAF

### **1. COMPONENTES NECESSÁRIOS**

#### **A. Ride Queue Manager**

**Responsabilidades:**
- Gerenciar filas de corridas por região
- Implementar lógica de expansão de raio
- Coordenar distribuição sequencial
- Gerenciar estados de corridas

**Estrutura de Dados:**

```javascript
// Redis Structures:

// 1. Fila principal por região (usando GeoHash)
ride_queue:{region}:pending
  Type: Sorted Set (ZADD/ZRANGE)
  Score: timestamp + priority
  Value: bookingId

// 2. Corridas em busca ativa
ride_queue:{region}:active
  Type: Hash
  Key: bookingId
  Value: { 
    bookingId, customerId, pickup, 
    radius: 3|5, startedAt, notifiedDrivers: []
  }

// 3. Motoristas notificados (evitar duplicação)
ride_notifications:{bookingId}
  Type: Set
  Members: [driverId1, driverId2, ...]

// 4. Lock por motorista (evitar sobreposição)
driver_lock:{driverId}
  Type: String (com TTL)
  Value: bookingId
  TTL: 20s (timeout de resposta)
```

#### **B. Radius Expansion Manager**

**Responsabilidades:**
- Monitorar tempo de espera das corridas
- Expandir raio de 3km → 5km após 1 minuto
- Recalcular motoristas disponíveis

**Fluxo:**

```javascript
// Tarefa agendada (a cada 10 segundos)
async function checkRadiusExpansion() {
  // Buscar corridas ativas há > 60s com raio = 3km
  const oldRequests = await redis.zrangebyscore(
    'ride_queue:active',
    Date.now() - 60000, // 1 minuto atrás
    '+inf'
  );
  
  for (const bookingId of oldRequests) {
    const booking = await redis.hget('ride_queue:active', bookingId);
    if (booking.radius === 3) {
      // Expandir para 5km
      await expandRadius(bookingId, 5);
    }
  }
}
```

#### **C. Driver Notification Dispatcher**

**Responsabilidades:**
- Buscar motoristas disponíveis no raio
- Enviar notificações via WebSocket
- Gerenciar timeouts e respostas
- Prevenir múltiplas notificações para mesmo motorista

**Algoritmo de Seleção:**

```javascript
async function selectDriversForRide(bookingId, radius) {
  // 1. Buscar motoristas no raio usando Redis GEO
  const nearbyDrivers = await redis.georadius(
    'driver_locations',
    pickup.lng, pickup.lat,
    radius, 'km',
    'WITHCOORD', 'WITHDIST'
  );
  
  // 2. Filtrar apenas disponíveis e não ocupados
  const availableDrivers = await filterAvailable(nearbyDrivers);
  
  // 3. Ordenar por score:
  //    - Distância (peso 40%)
  //    - Rating (peso 20%)
  //    - Acceptance rate (peso 20%)
  //    - Response time médio (peso 20%)
  const scoredDrivers = scoreDrivers(availableDrivers);
  
  // 4. Selecionar top N (ex: 10)
  return scoredDrivers.slice(0, 10);
}
```

#### **D. Response Handler**

**Responsabilidades:**
- Processar aceitações/rejeições de motoristas
- Atualizar filas
- Notificar customer
- Liberar motorista para próxima corrida

**Estados de Corrida:**

```
PENDING → SEARCHING → MATCHED → ACCEPTED → IN_PROGRESS → COMPLETED
                            ↓
                       REJECTED → (volta para SEARCHING ou CANCELED)
```

---

### **2. PREVENÇÃO DE EVENTOS SOBREPOSTOS**

#### **A. Locks Distribuídos (Redis)**

```javascript
// Ao enviar corrida para motorista
async function notifyDriver(driverId, bookingId) {
  // Tentar adquirir lock
  const lockAcquired = await redis.set(
    `driver_lock:${driverId}`,
    bookingId,
    'EX', 20, // Timeout 20s
    'NX' // Só cria se não existir
  );
  
  if (!lockAcquired) {
    // Motorista já tem corrida em processamento
    return { success: false, reason: 'driver_busy' };
  }
  
  // Enviar notificação
  io.to(`driver_${driverId}`).emit('newRideRequest', {
    bookingId,
    timeout: 15 // segundos
  });
  
  // Registrar que motorista foi notificado
  await redis.sadd(`ride_notifications:${bookingId}`, driverId);
  
  return { success: true };
}
```

#### **B. Idempotência por Booking**

```javascript
// Cada bookingId só pode estar em um estado por vez
async function updateBookingState(bookingId, newState) {
  const currentState = await redis.hget(`booking:${bookingId}`, 'state');
  
  // Validar transição de estado
  const validTransitions = {
    'PENDING': ['SEARCHING', 'CANCELED'],
    'SEARCHING': ['MATCHED', 'CANCELED', 'EXPANDED'],
    'MATCHED': ['ACCEPTED', 'REJECTED'],
    'ACCEPTED': ['IN_PROGRESS', 'CANCELED'],
    // ...
  };
  
  if (!validTransitions[currentState]?.includes(newState)) {
    throw new Error(`Invalid state transition: ${currentState} → ${newState}`);
  }
  
  // Atualizar com verificação de versão
  const result = await redis.hset(
    `booking:${bookingId}`,
    'state', newState,
    'updatedAt', Date.now()
  );
  
  return result;
}
```

#### **C. Event Sourcing Pattern**

```javascript
// Registrar todos os eventos (audit trail)
async function recordEvent(eventType, data) {
  await redis.xadd(
    'ride_events',
    '*',
    'type', eventType,
    'bookingId', data.bookingId,
    'driverId', data.driverId || '',
    'timestamp', Date.now(),
    'data', JSON.stringify(data)
  );
}

// Exemplos:
// - ride_requested: { bookingId, customerId, pickup }
// - driver_notified: { bookingId, driverId }
// - ride_accepted: { bookingId, driverId }
// - ride_rejected: { bookingId, driverId }
// - radius_expanded: { bookingId, newRadius }
```

#### **D. Transaction Log**

```javascript
// Todas as operações críticas são atômicas
async function processDriverResponse(driverId, bookingId, response) {
  const transaction = redis.multi();
  
  // 1. Verificar lock
  transaction.get(`driver_lock:${driverId}`);
  
  // 2. Atualizar estado do booking
  transaction.hset(`booking:${bookingId}`, {
    state: response === 'accepted' ? 'ACCEPTED' : 'REJECTED',
    driverId: response === 'accepted' ? driverId : null,
    respondedAt: Date.now()
  });
  
  // 3. Remover da fila ativa se aceito
  if (response === 'accepted') {
    transaction.zrem('ride_queue:active', bookingId);
  }
  
  // 4. Liberar lock do motorista
  transaction.del(`driver_lock:${driverId}`);
  
  // 5. Registrar evento
  transaction.xadd('ride_events', '*', ...);
  
  // Executar tudo ou nada
  const results = await transaction.exec();
  
  return results;
}
```

---

### **3. FILA DE MÚLTIPLAS CORRIDAS**

#### **A. Estrutura da Fila por Região**

```javascript
// GeoHash para dividir por região
function getRegionHash(lat, lng) {
  // Usar GeoHash de precisão 5 (≈5km x 5km)
  return geohash.encode(lat, lng, 5);
}

// Quando corrida é criada
async function enqueueRide(bookingData) {
  const { pickup, bookingId } = bookingData;
  const regionHash = getRegionHash(pickup.lat, pickup.lng);
  
  // Adicionar à fila da região
  await redis.zadd(
    `ride_queue:${regionHash}:pending`,
    Date.now(), // Prioridade: mais antiga primeiro
    bookingId
  );
  
  // Armazenar dados da corrida
  await redis.hset(`booking:${bookingId}`, {
    ...bookingData,
    state: 'PENDING',
    region: regionHash,
    createdAt: Date.now()
  });
  
  // Iniciar processamento assíncrono
  processNextRides(regionHash);
}
```

#### **B. Processamento Sequencial com Batch**

```javascript
// Processar próximas N corridas da fila
async function processNextRides(regionHash, batchSize = 10) {
  // Buscar próximas corridas pendentes
  const pendingRides = await redis.zrange(
    `ride_queue:${regionHash}:pending`,
    0, batchSize - 1
  );
  
  if (pendingRides.length === 0) return;
  
  // Processar cada corrida
  for (const bookingId of pendingRides) {
    // Verificar se já está em processamento
    const isActive = await redis.hexists(`booking:${bookingId}`, 'state');
    if (isActive && (await redis.hget(`booking:${bookingId}`, 'state')) !== 'PENDING') {
      continue; // Pular se já está sendo processada
    }
    
    // Mover para fila ativa
    await redis.zrem(`ride_queue:${regionHash}:pending`, bookingId);
    await redis.zadd(`ride_queue:${regionHash}:active`, Date.now(), bookingId);
    
    // Atualizar estado
    await redis.hset(`booking:${bookingId}`, 'state', 'SEARCHING');
    
    // Buscar e notificar motoristas
    await findAndNotifyDrivers(bookingId);
  }
}
```

#### **C. Distribuição Sequencial**

```javascript
// Quando motorista rejeita, enviar próxima corrida
async function handleDriverRejection(driverId, bookingId) {
  // 1. Remover motorista da lista de notificados desta corrida
  await redis.srem(`ride_notifications:${bookingId}`, driverId);
  
  // 2. Liberar lock do motorista
  await redis.del(`driver_lock:${driverId}`);
  
  // 3. Verificar se corrida ainda está ativa
  const bookingState = await redis.hget(`booking:${bookingId}`, 'state');
  
  if (bookingState === 'SEARCHING') {
    // Corrida ainda está sendo buscada
    // Enviar próxima corrida da fila para este motorista
    await sendNextRideToDriver(driverId, bookingId);
  }
  
  // 4. Continuar buscando motoristas para esta corrida
  await findAndNotifyDrivers(bookingId);
}

// Enviar próxima corrida para motorista
async function sendNextRideToDriver(driverId, currentBookingId) {
  // Buscar região do motorista
  const driverLocation = await redis.geopos('driver_locations', driverId);
  const regionHash = getRegionHash(driverLocation[0][1], driverLocation[0][0]);
  
  // Buscar próxima corrida na fila da região
  const nextRides = await redis.zrange(
    `ride_queue:${regionHash}:pending`,
    0, 10
  );
  
  // Encontrar próxima corrida que motorista ainda não foi notificado
  for (const nextBookingId of nextRides) {
    const wasNotified = await redis.sismember(
      `ride_notifications:${nextBookingId}`,
      driverId
    );
    
    if (!wasNotified) {
      // Enviar esta corrida
      await notifyDriver(driverId, nextBookingId);
      break;
    }
  }
}
```

---

### **4. INTEGRAÇÃO COM ESTRUTURA ATUAL**

#### **A. Modificações no `server.js`**

**Antes (Atual):**
```javascript
socket.on('createBooking', async (data) => {
  // ... criar booking ...
  // Enviar para TODOS os drivers
  io.to('drivers_room').emit('rideRequest', {...});
});
```

**Depois (Proposto):**
```javascript
socket.on('createBooking', async (data) => {
  // ... validar dados ...
  
  // Adicionar à fila em vez de enviar diretamente
  await rideQueueManager.enqueueRide({
    bookingId,
    customerId,
    pickupLocation,
    destinationLocation,
    estimatedFare,
    paymentMethod,
    status: 'PENDING'
  });
  
  // Confirmar criação
  socket.emit('bookingCreated', {
    success: true,
    bookingId,
    message: 'Corrida adicionada à fila'
  });
});
```

#### **B. Novo Handler para Rejeição**

```javascript
socket.on('rejectRide', async (data) => {
  const { bookingId, driverId, reason } = data;
  
  // Processar rejeição na fila
  await rideQueueManager.handleRejection(bookingId, driverId, reason);
  
  // Resposta ao motorista
  socket.emit('rideRejected', {
    success: true,
    bookingId,
    message: 'Corrida rejeitada. Próxima corrida será enviada.'
  });
  
  // Automaticamente enviar próxima corrida
  await rideQueueManager.sendNextRideToDriver(driverId);
});
```

#### **C. Integração com Redis GEO Existente**

**Já temos:**
```javascript
// DriverResolver.js usa Redis GEO
await this.redis.georadius(
  'driver_locations',
  lng, lat,
  radius, 'km',
  'WITHCOORD'
);
```

**Reutilizar para busca na fila:**
```javascript
// Buscar motoristas para corrida na fila
async function findDriversForBooking(bookingId) {
  const booking = await redis.hgetall(`booking:${bookingId}`);
  const { pickupLocation, radius } = booking;
  
  // Usar mesmo método que DriverResolver
  const nearbyDrivers = await redis.georadius(
    'driver_locations',
    pickupLocation.lng,
    pickupLocation.lat,
    radius,
    'km',
    'WITHCOORD',
    'WITHDIST'
  );
  
  return nearbyDrivers;
}
```

---

### **5. FLUXO COMPLETO PROPOSTO**

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CUSTOMER CRIA BOOKING                                    │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. RIDE QUEUE MANAGER                                       │
│    - Adiciona à fila da região (GeoHash)                   │
│    - Estado: PENDING                                         │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PROCESSAMENTO ASSÍNCRONO                                 │
│    - Worker busca próximas 10 corridas da fila              │
│    - Para cada uma:                                         │
│      * Estado: PENDING → SEARCHING                          │
│      * Buscar motoristas no raio (3km inicial)             │
│      * Selecionar top 10 por score                         │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. NOTIFICAÇÃO DE MOTORISTAS                                │
│    - Para cada motorista selecionado:                      │
│      * Adquirir lock (driver_lock:{driverId})              │
│      * Enviar via WebSocket                                │
│      * Registrar notificação                               │
│      * Timeout: 15s                                         │
└──────────────────┬──────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌──────────────┐    ┌──────────────────┐
│ ACEITA       │    │ REJEITA          │
│ - Match OK   │    │ - Liberar lock   │
│ - Remover    │    │ - Próxima corrida│
│   da fila    │    │ - Continuar busca│
└──────────────┘    └──────────────────┘
                           │
                           ▼
              ┌──────────────────────────┐
              │ 5. EXPANSÃO DE RAIO      │
              │    (Após 60s)            │
              │    - Se raio = 3km       │
              │    - Expandir para 5km   │
              │    - Buscar mais drivers │
              └──────────────────────────┘
```

---

### **6. CASOS ESPECIAIS**

#### **A. Múltiplas Corridas Simultâneas na Mesma Região**

**Problema:** 20 corridas simultâneas, 10 motoristas disponíveis

**Solução:**
```javascript
// Processar em batches
async function processBatch(regionHash) {
  // Buscar 10 corridas pendentes
  const rides = await redis.zrange(..., 0, 9);
  
  // Para cada corrida, buscar motoristas
  // Mas garantir que mesmo motorista não recebe múltiplas ao mesmo tempo
  const availableDrivers = await getAvailableDrivers(regionHash);
  
  // Distribuir corridas entre motoristas disponíveis
  for (let i = 0; i < rides.length; i++) {
    const bookingId = rides[i];
    const driver = availableDrivers[i % availableDrivers.length];
    
    if (driver && !driver.isBusy) {
      await notifyDriver(driver.id, bookingId);
      driver.isBusy = true; // Marcar como ocupado neste batch
    }
  }
}
```

#### **B. Motorista Aceita e Corrida é Cancelada**

```javascript
async function handleBookingCancellation(bookingId) {
  // 1. Verificar se motorista já aceitou
  const booking = await redis.hgetall(`booking:${bookingId}`);
  
  if (booking.state === 'ACCEPTED' || booking.state === 'IN_PROGRESS') {
    // Corrida em andamento - aplicar política de cancelamento
    await handleActiveCancellation(bookingId);
  } else {
    // Apenas remover da fila
    await redis.zrem(`ride_queue:*:pending`, bookingId);
    await redis.zrem(`ride_queue:*:active`, bookingId);
    await redis.hset(`booking:${bookingId}`, 'state', 'CANCELED');
    
    // Liberar motoristas notificados
    const notifiedDrivers = await redis.smembers(`ride_notifications:${bookingId}`);
    for (const driverId of notifiedDrivers) {
      await redis.del(`driver_lock:${driverId}`);
    }
  }
}
```

#### **C. Todos os Motoristas Ocupados**

```javascript
async function checkRegionalCapacity(regionHash) {
  // Buscar motoristas disponíveis na região
  const availableDrivers = await getAvailableDriversInRegion(regionHash);
  
  // Buscar corridas pendentes
  const pendingRides = await redis.zcard(`ride_queue:${regionHash}:pending`);
  
  if (availableDrivers.length === 0 && pendingRides > 0) {
    // Não há motoristas disponíveis
    // Opções:
    // 1. Expandir busca para regiões adjacentes
    // 2. Notificar customers sobre alta demanda
    // 3. Sugerir horário alternativo
    
    await notifyCustomersAboutHighDemand(regionHash);
  }
}
```

---

## 📋 CHECKLIST DE IMPLEMENTAÇÃO

### **Fase 1: Infraestrutura Base**

- [ ] Criar `RideQueueManager` class
- [ ] Implementar estrutura Redis para filas
- [ ] Implementar GeoHash para divisão regional
- [ ] Criar sistema de locks distribuídos
- [ ] Implementar event sourcing básico

### **Fase 2: Matching Básico**

- [ ] Integrar com `DriverResolver.nearbyDrivers()` existente
- [ ] Implementar seleção de motoristas por score
- [ ] Criar `DriverNotificationDispatcher`
- [ ] Implementar timeout de resposta
- [ ] Criar handlers para aceitação/rejeição

### **Fase 3: Expansão de Raio**

- [ ] Criar `RadiusExpansionManager`
- [ ] Implementar tarefa agendada (cron/interval)
- [ ] Lógica de expansão 3km → 5km
- [ ] Rebusca de motoristas após expansão

### **Fase 4: Múltiplas Corridas**

- [ ] Implementar processamento em batch
- [ ] Distribuição sequencial
- [ ] Prevenção de duplicação de notificações
- [ ] Gerenciamento de estados

### **Fase 5: Integração**

- [ ] Modificar `server.js` `createBooking`
- [ ] Criar handler `rejectRide`
- [ ] Integrar com WebSocket existente
- [ ] Testes end-to-end

### **Fase 6: Otimizações**

- [ ] Cache de resultados de busca
- [ ] Previsão de demanda (ML)
- [ ] Balanceamento regional
- [ ] Métricas e monitoramento

---

## 🎯 PRÓXIMOS PASSOS

1. **Revisar estrutura atual** - Confirmar componentes reutilizáveis
2. **Definir prioridades** - Qual fase implementar primeiro
3. **Criar protótipo** - Validar conceito com implementação mínima
4. **Testes** - Validar com múltiplas corridas simultâneas
5. **Otimização** - Refinar com base em métricas reais

---

**Documento criado em:** 01/11/2025  
**Status:** 📚 Estudo Completo - Pronto para Implementação


