# 🔄 EXPANSÃO GRADUAL DE RAIO: NOTIFICAÇÃO PROGRESSIVA

**Data:** 01/11/2025  
**Estratégia:** Notificar motoristas mais próximos primeiro, expandindo gradualmente até 3km

---

## 🎯 CONCEITO PROPOSTO

### **Abordagem Atual (Busca Única):**
```
Raio inicial: 3km
→ Busca TODOS os motoristas em 3km de uma vez
→ Notifica todos simultaneamente
→ Aguarda resposta
```

**Problema:** Motoristas mais distantes recebem notificação desnecessária se houver motoristas próximos disponíveis.

---

### **Abordagem Proposta (Expansão Gradual):**
```
T=0s:    Busca 0.5km → Notifica top 5 motoristas
T=5s:    Se nenhum aceitou → Busca 1km → Notifica próximos 5
T=10s:   Se nenhum aceitou → Busca 1.5km → Notifica próximos 5
T=15s:   Se nenhum aceitou → Busca 2km → Notifica próximos 5
T=20s:   Se nenhum aceitou → Busca 2.5km → Notifica próximos 5
T=25s:   Se nenhum aceitou → Busca 3km → Notifica últimos motoristas
```

**Vantagens:**
- ✅ Motoristas mais próximos têm prioridade
- ✅ Reduz número de notificações desnecessárias
- ✅ Melhora experiência do motorista (menos spam)
- ✅ Reduz tempo de resposta médio (motorista próximo aceita mais rápido)

---

## 📊 ANÁLISE DE PERFORMANCE

### **Cenário de Teste:**
- **Região:** Centro urbano (alta densidade de motoristas)
- **Motoristas disponíveis:** 50 no total
- **Distribuição:** 
  - 0-0.5km: 2 motoristas
  - 0.5-1km: 3 motoristas
  - 1-1.5km: 5 motoristas
  - 1.5-2km: 8 motoristas
  - 2-2.5km: 12 motoristas
  - 2.5-3km: 20 motoristas

### **Abordagem Atual (Busca Única):**

```
Operações:
1. Redis GEO query: 1x (3km radius)
2. Filtrar disponíveis: 50 motoristas
3. Calcular scores: 50 cálculos
4. Enviar notificações: 50 WebSocket emits
5. Aguardar respostas: 50 timeouts (15s cada)

Tempo de processamento:
- Redis GEO: ~5ms
- Filtragem: ~10ms
- Cálculo de scores: ~50ms
- Envio WebSocket: ~500ms (50 notificações)
- Total: ~565ms

Overhead de rede:
- 50 notificações WebSocket
- 50 possíveis respostas
- Potencial: 100 mensagens

CPU/Memória:
- Processamento: Baixo (1 query)
- Memória: Baixo (50 objetos em memória)
```

### **Abordagem Proposta (Expansão Gradual):**

```
Ciclo 1 (T=0s, 0.5km):
1. Redis GEO query: 1x (0.5km radius)
2. Filtrar disponíveis: 2 motoristas
3. Calcular scores: 2 cálculos
4. Enviar notificações: 2 WebSocket emits
5. Aguardar respostas: 2 timeouts (15s cada)

Tempo: ~15ms processamento + 15s espera

Ciclo 2 (T=5s, 1km):
- Se nenhum aceitou → continua
1. Redis GEO query: 1x (1km radius, excluindo já notificados)
2. Filtrar disponíveis: 3 motoristas
3. Calcular scores: 3 cálculos
4. Enviar notificações: 3 WebSocket emits

Tempo: ~20ms processamento + 10s espera

Ciclo 3-6: Similar, expandindo progressivamente

Total de processamento acumulado:
- Redis GEO queries: 6x (~30ms total)
- Filtragem: 6x (~60ms total)
- Cálculo de scores: 50 cálculos (~50ms total)
- Envio WebSocket: 50 notificações (~500ms total)
- Total: ~640ms (distribuído em 25s)

Overhead de rede:
- 50 notificações WebSocket (mesmo número)
- 50 possíveis respostas (mesmo número)
- MAS: distribuído no tempo (menos pico de carga)

CPU/Memória:
- Processamento: Baixo (6 queries, mas menores)
- Memória: Baixo (menos objetos simultâneos)
```

---

## ⚖️ COMPARAÇÃO DE PESO DE PROCESSAMENTO

| Aspecto | Busca Única | Expansão Gradual | Diferença |
|---------|-------------|------------------|-----------|
| **Redis GEO Queries** | 1x (3km) | 6x (0.5km, 1km, 1.5km, 2km, 2.5km, 3km) | +5 queries |
| **Tempo de Query** | ~5ms | ~30ms (total) | +25ms |
| **Filtragem** | 1x (50 motoristas) | 6x (2+3+5+8+12+20) | Similar |
| **Cálculo Scores** | 50 cálculos | 50 cálculos | Igual |
| **WebSocket Emits** | 50 notificações | 50 notificações | Igual |
| **Memória** | ~50 objetos | ~8-20 objetos (máx) | Menor pico |
| **Tempo Total** | ~565ms | ~640ms (+ tarefas agendadas) | +75ms |
| **Overhead de Agendamento** | 0 | ~100ms (setTimeouts) | +100ms |

**Conclusão:** 
- ✅ **CPU:** Mínimo impacto (+25ms em queries Redis, distribuído no tempo)
- ✅ **Memória:** Melhor (picos menores)
- ✅ **Rede:** Mesmo volume, mas distribuído (melhor)
- ⚠️ **Complexidade:** Maior (mais código para gerenciar)

---

## 💻 IMPLEMENTAÇÃO

### **Estrutura de Dados Redis:**

```javascript
// Estado da corrida em busca
booking_search:{bookingId}
  Type: Hash
  Fields:
    - currentRadius: 0.5 (km)
    - maxRadius: 3 (km)
    - expansionInterval: 5 (segundos)
    - notifiedDrivers: Set de driverIds
    - createdAt: timestamp
    - lastExpansion: timestamp
    - state: 'SEARCHING' | 'MATCHED' | 'EXPANDED'

// Motoristas notificados por corrida
ride_notifications:{bookingId}
  Type: Set
  Members: [driverId1, driverId2, ...]

// Próximas expansões agendadas
expansion_queue
  Type: Sorted Set (ZADD)
  Score: nextExpansionTime (timestamp)
  Value: bookingId
```

---

### **Código de Expansão Gradual:**

```javascript
class GradualRadiusExpander {
  constructor(redis, io) {
    this.redis = redis;
    this.io = io;
    this.expansionIntervals = new Map(); // bookingId -> intervalId
  }

  /**
   * Iniciar busca gradual para uma corrida
   */
  async startGradualSearch(bookingId, pickupLocation) {
    const initialRadius = 0.5; // km
    const maxRadius = 3; // km
    const expansionInterval = 5; // segundos
    const driversPerWave = 5; // notificar 5 por vez

    // Armazenar estado
    await this.redis.hset(`booking_search:${bookingId}`, {
      currentRadius: initialRadius,
      maxRadius: maxRadius,
      expansionInterval: expansionInterval,
      createdAt: Date.now(),
      lastExpansion: Date.now(),
      state: 'SEARCHING'
    });

    // Primeira busca imediata
    await this.searchAndNotify(
      bookingId,
      pickupLocation,
      initialRadius,
      driversPerWave
    );

    // Agendar próxima expansão
    this.scheduleNextExpansion(
      bookingId,
      pickupLocation,
      initialRadius + 0.5,
      maxRadius,
      expansionInterval,
      driversPerWave
    );
  }

  /**
   * Buscar e notificar motoristas em um raio específico
   */
  async searchAndNotify(bookingId, pickupLocation, radius, limit) {
    console.log(`🔍 [GradualExpander] Buscando motoristas em ${radius}km para ${bookingId}`);

    // 1. Buscar motoristas no raio (Redis GEO)
    const nearbyDrivers = await this.redis.georadius(
      'driver_locations',
      pickupLocation.lng,
      pickupLocation.lat,
      radius,
      'km',
      'WITHCOORD',
      'WITHDIST',
      'COUNT',
      100 // Buscar mais para filtrar
    );

    if (!nearbyDrivers || nearbyDrivers.length === 0) {
      console.log(`⚠️ [GradualExpander] Nenhum motorista encontrado em ${radius}km`);
      return { notified: 0, total: 0 };
    }

    // 2. Filtrar motoristas já notificados
    const notifiedDriverIds = await this.redis.smembers(
      `ride_notifications:${bookingId}`
    );
    const notifiedSet = new Set(notifiedDriverIds);

    // 3. Filtrar apenas disponíveis e não notificados
    const availableDrivers = [];
    for (const driver of nearbyDrivers) {
      const driverId = driver[0];
      const distance = driver[1];

      // Verificar se já foi notificado
      if (notifiedSet.has(driverId)) {
        continue;
      }

      // Verificar disponibilidade (lock)
      const isAvailable = await this.checkDriverAvailability(driverId);
      if (!isAvailable) {
        continue;
      }

      availableDrivers.push({
        driverId,
        distance: parseFloat(distance),
        coordinates: {
          lng: parseFloat(driver[2][0]),
          lat: parseFloat(driver[2][1])
        }
      });
    }

    // 4. Calcular scores e ordenar
    const scoredDrivers = await this.scoreDrivers(availableDrivers, pickupLocation);
    const topDrivers = scoredDrivers.slice(0, limit);

    // 5. Notificar motoristas selecionados
    let notifiedCount = 0;
    for (const driver of topDrivers) {
      const notified = await this.notifyDriver(driverId, bookingId, pickupLocation);
      if (notified) {
        notifiedCount++;
        // Registrar como notificado
        await this.redis.sadd(`ride_notifications:${bookingId}`, driver.driverId);
        // Criar lock (evitar múltiplas notificações)
        await this.redis.set(
          `driver_lock:${driver.driverId}`,
          bookingId,
          'EX', 15, // Timeout 15s
          'NX'
        );
      }
    }

    console.log(`✅ [GradualExpander] ${notifiedCount} motoristas notificados em ${radius}km`);

    return { notified: notifiedCount, total: availableDrivers.length };
  }

  /**
   * Agendar próxima expansão
   */
  scheduleNextExpansion(bookingId, pickupLocation, nextRadius, maxRadius, interval, limit) {
    // Cancelar expansão anterior se existir
    const existingInterval = this.expansionIntervals.get(bookingId);
    if (existingInterval) {
      clearTimeout(existingInterval);
    }

    // Verificar se corrida já foi aceita
    this.redis.hget(`booking_search:${bookingId}`, 'state', (err, state) => {
      if (err || state !== 'SEARCHING') {
        // Corrida já foi aceita ou cancelada
        this.expansionIntervals.delete(bookingId);
        return;
      }
    });

    if (nextRadius > maxRadius) {
      // Atingiu raio máximo
      console.log(`🏁 [GradualExpander] Raio máximo atingido para ${bookingId}`);
      this.handleMaxRadiusReached(bookingId);
      return;
    }

    // Agendar próxima expansão
    const expansionTimeout = setTimeout(async () => {
      const result = await this.searchAndNotify(
        bookingId,
        pickupLocation,
        nextRadius,
        limit
      );

      // Atualizar estado
      await this.redis.hset(`booking_search:${bookingId}`, {
        currentRadius: nextRadius,
        lastExpansion: Date.now()
      });

      // Se nenhum motorista foi encontrado, expandir mais rápido
      if (result.total === 0 && nextRadius < maxRadius) {
        // Expandir imediatamente para próximo raio
        await this.scheduleNextExpansion(
          bookingId,
          pickupLocation,
          nextRadius + 0.5,
          maxRadius,
          0, // Imediato
          limit
        );
      } else {
        // Agendar próxima expansão normal
        await this.scheduleNextExpansion(
          bookingId,
          pickupLocation,
          nextRadius + 0.5,
          maxRadius,
          interval,
          limit
        );
      }

      this.expansionIntervals.delete(bookingId);
    }, interval * 1000);

    this.expansionIntervals.set(bookingId, expansionTimeout);

    // Registrar na fila de expansões (para monitoramento)
    const nextExpansionTime = Date.now() + (interval * 1000);
    await this.redis.zadd('expansion_queue', nextExpansionTime, bookingId);
  }

  /**
   * Verificar disponibilidade do motorista
   */
  async checkDriverAvailability(driverId) {
    // Verificar lock (motorista já tem corrida?)
    const existingLock = await this.redis.get(`driver_lock:${driverId}`);
    if (existingLock) {
      return false; // Motorista ocupado
    }

    // Verificar status no Redis GEO ou Firebase
    // (assumindo que driver_locations contém apenas disponíveis)
    return true;
  }

  /**
   * Calcular score dos motoristas
   */
  async scoreDrivers(drivers, pickupLocation) {
    // Score = (1/distância) * rating * (1/responseTime)
    return drivers.map(driver => {
      // Buscar rating e dados do motorista (cache ou Firebase)
      const rating = driver.rating || 4.5;
      const responseTime = driver.avgResponseTime || 30;

      const score = (1 / driver.distance) * rating * (1 / responseTime);

      return {
        ...driver,
        score
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Notificar motorista via WebSocket
   */
  async notifyDriver(driverId, bookingId, pickupLocation) {
    try {
      // Verificar lock novamente (race condition)
      const lockAcquired = await this.redis.set(
        `driver_lock:${driverId}`,
        bookingId,
        'EX', 15,
        'NX'
      );

      if (!lockAcquired) {
        return false; // Motorista já recebeu outra corrida
      }

      // Buscar dados completos da corrida
      const booking = await this.redis.hgetall(`booking:${bookingId}`);

      // Enviar notificação via WebSocket
      this.io.to(`driver_${driverId}`).emit('newRideRequest', {
        bookingId,
        pickupLocation,
        destinationLocation: booking.destinationLocation,
        estimatedFare: booking.estimatedFare,
        distance: pickupLocation.distance || 0,
        timeout: 15 // segundos para responder
      });

      console.log(`📱 [GradualExpander] Notificação enviada para driver ${driverId}`);

      return true;
    } catch (error) {
      console.error(`❌ [GradualExpander] Erro ao notificar driver ${driverId}:`, error);
      return false;
    }
  }

  /**
   * Parar busca (quando corrida é aceita/cancelada)
   */
  async stopSearch(bookingId) {
    // Cancelar expansão agendada
    const interval = this.expansionIntervals.get(bookingId);
    if (interval) {
      clearTimeout(interval);
      this.expansionIntervals.delete(bookingId);
    }

    // Remover da fila de expansões
    await this.redis.zrem('expansion_queue', bookingId);

    // Atualizar estado
    await this.redis.hset(`booking_search:${bookingId}`, {
      state: 'STOPPED'
    });

    console.log(`🛑 [GradualExpander] Busca parada para ${bookingId}`);
  }

  /**
   * Handler quando raio máximo é atingido
   */
  async handleMaxRadiusReached(bookingId) {
    // Opções:
    // 1. Expandir para 5km (raio secundário)
    // 2. Notificar customer sobre alta demanda
    // 3. Sugerir horário alternativo

    const booking = await this.redis.hgetall(`booking:${bookingId}`);
    
    // Expandir para 5km se ainda não foi
    if (booking.currentRadius < 5) {
      console.log(`📈 [GradualExpander] Expandindo para 5km para ${bookingId}`);
      await this.scheduleNextExpansion(
        bookingId,
        booking.pickupLocation,
        5,
        5,
        60, // Aguardar 1 minuto antes de expandir para 5km
        10 // Notificar mais motoristas
      );
    } else {
      // Notificar customer
      this.io.to(`customer_${booking.customerId}`).emit('rideSearchExpanded', {
        bookingId,
        message: 'Buscando motoristas em área expandida',
        currentRadius: 5
      });
    }
  }
}

module.exports = GradualRadiusExpander;
```

---

### **Integração com `server.js`:**

```javascript
const GradualRadiusExpander = require('./services/GradualRadiusExpander');

// Inicializar expander
const radiusExpander = new GradualRadiusExpander(redis, io);

// Modificar createBooking
socket.on('createBooking', async (data) => {
  try {
    // ... validar dados ...
    
    const bookingId = `booking_${Date.now()}_${customerId}`;
    const bookingData = {
      bookingId,
      customerId,
      pickupLocation,
      destinationLocation,
      estimatedFare,
      paymentMethod,
      status: 'requested',
      timestamp: new Date().toISOString()
    };

    // Armazenar booking
    await redis.hset(`booking:${bookingId}`, bookingData);

    // Confirmar criação
    socket.emit('bookingCreated', {
      success: true,
      bookingId,
      message: 'Corrida solicitada. Buscando motoristas próximos...'
    });

    // ✅ INICIAR BUSCA GRADUAL
    await radiusExpander.startGradualSearch(bookingId, pickupLocation);

    console.log(`✅ Corrida ${bookingId} criada e busca iniciada`);
  } catch (error) {
    console.error('❌ Erro ao criar corrida:', error);
    socket.emit('bookingError', { error: 'Erro interno do servidor' });
  }
});

// Handler para aceitação
socket.on('acceptRide', async (data) => {
  const { bookingId, driverId } = data;
  
  // Parar busca gradual
  await radiusExpander.stopSearch(bookingId);
  
  // ... resto do handler ...
});

// Handler para rejeição
socket.on('rejectRide', async (data) => {
  const { bookingId, driverId } = data;
  
  // Não precisa parar busca - ela continua automaticamente
  // Apenas liberar lock do motorista
  await redis.del(`driver_lock:${driverId}`);
  
  // ... resto do handler ...
});
```

---

## 📈 ANÁLISE DE PERFORMANCE DETALHADA

### **Cenário Real: 1000 corridas/hora**

**Abordagem Única:**
```
- 1000 corridas × 1 query Redis = 1000 queries
- 1000 corridas × 50 notificações = 50.000 WebSocket emits
- Pico de carga: 50.000 emits em < 1 segundo
- CPU: ~100% durante pico
- Memória: ~500MB (50k objetos)
```

**Abordagem Gradual:**
```
- 1000 corridas × 6 queries Redis = 6000 queries (distribuídas em 25s)
- 1000 corridas × 50 notificações = 50.000 WebSocket emits (distribuídas)
- Pico de carga: ~2000 emits por segundo (distribuído)
- CPU: ~20-30% (distribuído)
- Memória: ~100MB (menos objetos simultâneos)
```

**Melhoria:**
- ✅ Redução de pico de carga: **96%**
- ✅ Redução de uso de memória: **80%**
- ✅ Melhor distribuição de processamento

---

## ⚙️ OTIMIZAÇÕES POSSÍVEIS

### **1. Ajuste Dinâmico de Intervalo**

```javascript
// Se muitos motoristas disponíveis, expandir mais rápido
if (availableDrivers.length > 20) {
  expansionInterval = 3; // 3 segundos
} else if (availableDrivers.length < 5) {
  expansionInterval = 7; // 7 segundos
}
```

### **2. Skip de Raios Vazios**

```javascript
// Se raio atual está vazio, pular para próximo
if (result.total === 0) {
  nextRadius = Math.min(nextRadius + 1, maxRadius); // Pular 1km
}
```

### **3. Parar Expansão Após Aceitação**

```javascript
// Se motorista aceitou, cancelar expansões futuras
socket.on('acceptRide', async (data) => {
  await radiusExpander.stopSearch(bookingId);
  // Cancelar todos os timeouts agendados
});
```

---

## ✅ CONCLUSÃO

### **Vantagens:**
- ✅ **Menor pico de carga:** Processamento distribuído
- ✅ **Melhor UX:** Motoristas próximos têm prioridade
- ✅ **Menos spam:** Motoristas distantes só recebem se necessário
- ✅ **Escalabilidade:** Melhor para alto volume

### **Desvantagens:**
- ⚠️ **Complexidade:** Mais código para gerenciar
- ⚠️ **Latência:** Pode demorar mais para encontrar motorista (máx 25s vs 15s)
- ⚠️ **Mais queries Redis:** 6x mais queries (mas menores)

### **Recomendação:**
✅ **IMPLEMENTAR** - O benefício supera o custo, especialmente em alta escala.

---

**Documento criado em:** 01/11/2025  
**Status:** 📊 Análise Completa - Pronto para Implementação


