# 🔍 Diagnóstico Completo: Problemas para Motorista Receber Notificação de Corrida

## 📋 **FLUXO COMPLETO DE NOTIFICAÇÃO**

### **1. Passageiro Solicita Corrida:**
```
Passageiro (app) → createBooking → Servidor → bookingCreated (confirmação)
```

### **2. Servidor Processa:**
```
createBooking → Adiciona à fila → QueueWorker processa → DriverNotificationDispatcher → Notifica motoristas
```

### **3. Motorista Recebe:**
```
Servidor → newRideRequest → Motorista (app) → Card aparece na tela
```

---

## 🔴 **POSSÍVEIS PROBLEMAS E SOLUÇÕES**

### **PROBLEMA #1: Motorista Não Está no Redis GEO**

**Sintoma:**
- Motorista não aparece em buscas
- Não recebe notificações

**Verificar:**
```bash
redis-cli ZRANGE driver_locations 0 -1
redis-cli GEOPOS driver_locations test_driver_xxx
```

**Causas Possíveis:**
1. ❌ Hash `driver:${driverId}` está vazio ou expirado
2. ❌ Localização não está sendo enviada
3. ❌ TTL expirou antes de renovar
4. ❌ `saveDriverLocation` não está sendo chamado

**Solução:**
- Verificar se motorista está enviando localização
- Verificar se hash existe e tem dados
- Verificar TTL do hash

---

### **PROBLEMA #2: Motorista Não Está Autenticado**

**Sintoma:**
- Motorista não está no room `driver_${driverId}`
- Notificação não chega

**Verificar:**
```javascript
// No servidor, verificar se motorista está no room
socket.join(`driver_${driverId}`);
```

**Causas Possíveis:**
1. ❌ Autenticação falhou
2. ❌ `socket.userId` não está definido
3. ❌ `socket.userType` não é `'driver'`
4. ❌ Room não foi criado

**Solução:**
- Verificar logs de autenticação
- Verificar se `socket.userId` está definido após autenticação
- Verificar se room foi criado

---

### **PROBLEMA #3: Motorista Não Está Online/Disponível**

**Sintoma:**
- Motorista está no GEO, mas não recebe notificação

**Verificar:**
```bash
redis-cli HGET driver:test_driver_xxx isOnline
redis-cli HGET driver:test_driver_xxx status
```

**Código que verifica:**
```javascript
// driver-notification-dispatcher.js linha 107
if (!driverData || !driverData.isOnline || driverData.status !== 'AVAILABLE') {
    continue; // Motorista offline ou não disponível
}
```

**Causas Possíveis:**
1. ❌ `isOnline` não é `'true'` (pode ser `'false'` ou `undefined`)
2. ❌ `status` não é `'AVAILABLE'` (pode ser `'OFFLINE'`, `'BUSY'`, etc.)
3. ❌ Hash não tem esses campos

**Solução:**
- Verificar se `isOnline: 'true'` e `status: 'AVAILABLE'` no hash
- Garantir que `saveDriverLocation` está salvando corretamente

---

### **PROBLEMA #4: Motorista Está Bloqueado (Lock)**

**Sintoma:**
- Motorista está online, mas não recebe notificação

**Verificar:**
```bash
redis-cli GET driver_lock:test_driver_xxx
```

**Código que verifica:**
```javascript
// driver-notification-dispatcher.js linha 100
const lockStatus = await driverLockManager.isDriverLocked(driverId);
if (lockStatus.isLocked) {
    continue; // Motorista ocupado
}
```

**Causas Possíveis:**
1. ❌ Motorista tem lock ativo de outra corrida
2. ❌ Lock não foi liberado após corrida anterior
3. ❌ Lock expirou mas ainda está no Redis

**Solução:**
- Verificar se há lock ativo
- Limpar lock se necessário
- Verificar se lock está sendo liberado corretamente

---

### **PROBLEMA #5: Motorista Já Foi Notificado**

**Sintoma:**
- Motorista não recebe notificação para corrida específica

**Verificar:**
```bash
redis-cli SMEMBERS ride_notifications:booking_xxx
```

**Código que verifica:**
```javascript
// driver-notification-dispatcher.js linha 80
const notifiedDriverIds = await this.redis.smembers(`ride_notifications:${bookingId}`);
const notifiedSet = new Set(notifiedDriverIds);

if (notifiedSet.has(driverId)) {
    continue; // Já foi notificado
}
```

**Causas Possíveis:**
1. ❌ Motorista já foi notificado para esta corrida
2. ❌ Set não foi limpo após corrida ser aceita/rejeitada
3. ❌ Motorista foi notificado em tentativa anterior

**Solução:**
- Verificar se motorista está no set de notificados
- Limpar set se necessário
- Verificar se set está sendo limpo corretamente

---

### **PROBLEMA #6: Motorista Fora do Raio de Busca**

**Sintoma:**
- Motorista não aparece em buscas próximas

**Verificar:**
```bash
# Verificar posição do motorista
redis-cli GEOPOS driver_locations test_driver_xxx

# Verificar posição do passageiro (pickupLocation)
# Comparar distâncias
```

**Código que busca:**
```javascript
// driver-notification-dispatcher.js linha 61
nearbyDrivers = await this.redis.georadius(
    'driver_locations',
    pickupLocation.lng,
    pickupLocation.lat,
    radius, // Raio em km
    'km',
    'WITHCOORD',
    'WITHDIST',
    'COUNT',
    100
);
```

**Causas Possíveis:**
1. ❌ Motorista está muito longe do ponto de pickup
2. ❌ Raio de busca é muito pequeno
3. ❌ Coordenadas estão incorretas

**Solução:**
- Verificar distância entre motorista e pickup
- Aumentar raio de busca se necessário
- Verificar se coordenadas estão corretas

---

### **PROBLEMA #7: QueueWorker Não Está Processando**

**Sintoma:**
- Corrida é criada, mas não é processada

**Verificar:**
```bash
# Verificar se corrida está na fila
redis-cli ZRANGE ride_queue:REGION:pending 0 -1
```

**Código que processa:**
```javascript
// queue-worker.js
// Processa filas a cada 3 segundos
setInterval(async () => {
    await this.processQueues();
}, this.config.processingInterval);
```

**Causas Possíveis:**
1. ❌ QueueWorker não está rodando
2. ❌ Corrida não foi adicionada à fila
3. ❌ Fila está vazia ou incorreta
4. ❌ Erro no processamento

**Solução:**
- Verificar se QueueWorker está ativo
- Verificar se corrida está na fila
- Verificar logs do QueueWorker

---

### **PROBLEMA #8: WebSocket Room Não Existe**

**Sintoma:**
- Notificação não chega ao motorista

**Verificar:**
```javascript
// No servidor, verificar se room existe
io.sockets.adapter.rooms.get(`driver_${driverId}`)
```

**Código que envia:**
```javascript
// driver-notification-dispatcher.js linha 280
this.io.to(`driver_${driverId}`).emit('newRideRequest', notificationData);
```

**Causas Possíveis:**
1. ❌ Room não foi criado na autenticação
2. ❌ Socket desconectou e room foi removido
3. ❌ `driverId` está incorreto

**Solução:**
- Verificar se room foi criado na autenticação
- Verificar se socket ainda está conectado
- Verificar se `driverId` está correto

---

### **PROBLEMA #9: App Não Está Escutando Evento**

**Sintoma:**
- Notificação chega, mas app não processa

**Verificar:**
```javascript
// DriverUI.js linha 511
webSocketManager.on('newRideRequest', handleNewBookingAvailable);
```

**Causas Possíveis:**
1. ❌ Listener não foi registrado
2. ❌ Listener foi removido
3. ❌ WebSocket não está conectado
4. ❌ Evento tem nome diferente

**Solução:**
- Verificar se listener está registrado
- Verificar se WebSocket está conectado
- Verificar nome do evento

---

### **PROBLEMA #10: Dados da Corrida Estão Incorretos**

**Sintoma:**
- Notificação chega, mas card não aparece

**Verificar:**
```javascript
// DriverUI.js linha 219
const handleNewBookingAvailable = (data) => {
    if (!data || !data.bookingId) {
        return; // Dados inválidos
    }
    setCurrentRideRequest(rideRequestData);
};
```

**Causas Possíveis:**
1. ❌ `bookingId` está faltando
2. ❌ `pickupLocation` está faltando
3. ❌ Dados estão em formato incorreto
4. ❌ `estimatedFare` está faltando

**Solução:**
- Verificar estrutura dos dados enviados
- Verificar se todos os campos obrigatórios estão presentes
- Verificar formato dos dados

---

### **PROBLEMA #11: Score Muito Baixo**

**Sintoma:**
- Motorista não aparece nos top motoristas

**Código que filtra:**
```javascript
// driver-notification-dispatcher.js linha 132
const topDrivers = scoredDrivers
    .sort((a, b) => b.score - a.score)
    .slice(0, limit); // Top N motoristas
```

**Causas Possíveis:**
1. ❌ Score muito baixo (distância, rating, etc.)
2. ❌ Muitos motoristas com score maior
3. ❌ Limite de motoristas muito baixo

**Solução:**
- Verificar score do motorista
- Aumentar limite de motoristas notificados
- Verificar critérios de score

---

### **PROBLEMA #12: Erro Silencioso no Processamento**

**Sintoma:**
- Nenhum erro visível, mas notificação não chega

**Verificar:**
```bash
# Logs do servidor
pm2 logs server | grep -E "(error|Error|❌|Dispatcher|QueueWorker)"
```

**Causas Possíveis:**
1. ❌ Erro sendo capturado e ignorado
2. ❌ Try/catch sem log
3. ❌ Promise rejeitada sem tratamento

**Solução:**
- Verificar logs do servidor
- Adicionar logs detalhados
- Verificar tratamento de erros

---

## ✅ **CHECKLIST DE DIAGNÓSTICO**

### **No Servidor (VPS):**

- [ ] Motorista está no GEO `driver_locations`?
- [ ] Hash `driver:${driverId}` existe e tem dados?
- [ ] `isOnline: 'true'` e `status: 'AVAILABLE'`?
- [ ] Motorista não tem lock ativo?
- [ ] Motorista não foi notificado para esta corrida?
- [ ] Motorista está dentro do raio de busca?
- [ ] QueueWorker está processando filas?
- [ ] Room `driver_${driverId}` existe?
- [ ] Corrida está na fila?
- [ ] DriverNotificationDispatcher está sendo chamado?
- [ ] Evento `newRideRequest` está sendo emitido?

### **No App (Motorista):**

- [ ] WebSocket está conectado?
- [ ] Autenticação foi bem-sucedida?
- [ ] Localização está sendo enviada?
- [ ] Motorista está online no app?
- [ ] Listener `newRideRequest` está registrado?
- [ ] App está processando evento?

### **No App (Passageiro):**

- [ ] `createBooking` está sendo enviado?
- [ ] Dados estão completos?
- [ ] `bookingCreated` está sendo recebido?
- [ ] Corrida foi criada no servidor?

---

## 🔧 **COMANDOS DE DIAGNÓSTICO**

### **1. Verificar Motorista no Redis:**
```bash
# Verificar se está no GEO
redis-cli ZRANGE driver_locations 0 -1

# Verificar posição
redis-cli GEOPOS driver_locations test_driver_xxx

# Verificar dados do hash
redis-cli HGETALL driver:test_driver_xxx

# Verificar TTL
redis-cli TTL driver:test_driver_xxx
```

### **2. Verificar Corrida:**
```bash
# Verificar se corrida foi criada
redis-cli KEYS "booking:*"

# Verificar dados da corrida
redis-cli HGETALL booking:booking_xxx

# Verificar se está na fila
redis-cli ZRANGE ride_queue:REGION:pending 0 -1
```

### **3. Verificar Notificações:**
```bash
# Verificar motoristas notificados
redis-cli SMEMBERS ride_notifications:booking_xxx

# Verificar locks
redis-cli KEYS "driver_lock:*"
```

### **4. Verificar Logs do Servidor:**
```bash
# Logs do servidor
pm2 logs server | grep -E "(Dispatcher|QueueWorker|createBooking|newRideRequest)"

# Logs específicos
tail -f /home/leaf/leaf-websocket-backend/server.log | grep -E "(Dispatcher|QueueWorker)"
```

---

## 💡 **SOLUÇÕES PRIORITÁRIAS**

### **Alta Prioridade:**
1. ✅ Verificar se motorista está no Redis GEO
2. ✅ Verificar se hash tem `isOnline: 'true'` e `status: 'AVAILABLE'`
3. ✅ Verificar se motorista está autenticado e no room correto
4. ✅ Verificar se QueueWorker está processando

### **Média Prioridade:**
5. ⚠️ Verificar se motorista não tem lock ativo
6. ⚠️ Verificar se motorista não foi notificado anteriormente
7. ⚠️ Verificar se motorista está dentro do raio de busca

### **Baixa Prioridade:**
8. ⏳ Verificar score do motorista
9. ⏳ Verificar logs de erros
10. ⏳ Verificar estrutura dos dados

---

## 🎯 **PRÓXIMOS PASSOS**

1. **Executar comandos de diagnóstico** para identificar problema específico
2. **Verificar logs do servidor** durante criação de corrida
3. **Verificar estado do Redis** (motorista, corrida, notificações)
4. **Testar fluxo completo** passo a passo


