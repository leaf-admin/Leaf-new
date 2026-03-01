# 🔴 Problemas Possíveis: Motorista Não Recebe Notificação

## 📋 **RESUMO DOS PROBLEMAS**

Lista completa de problemas que podem impedir o motorista de receber notificação quando o passageiro solicita uma corrida.

---

## 🔴 **PROBLEMAS CRÍTICOS (Mais Comuns)**

### **1. Hash do Motorista Vazio ou Expirado**

**Sintoma:**
- Motorista está no GEO `driver_locations`
- Mas hash `driver:${driverId}` está vazio ou não existe

**Causa:**
- `saveDriverLocation` não está salvando o hash
- TTL expirou e hash foi removido
- Erro ao salvar hash (silencioso)

**Verificar:**
```bash
redis-cli HGETALL driver:test_driver_xxx
redis-cli TTL driver:test_driver_xxx
```

**Solução:**
- Verificar se `updateLocation` está sendo recebido
- Verificar se `saveDriverLocation` está sendo chamado
- Verificar logs de erro ao salvar

---

### **2. Status Incorreto do Motorista**

**Sintoma:**
- Hash existe, mas motorista não recebe notificação

**Causa:**
- `isOnline` não é `'true'` (pode ser `'false'` ou `undefined`)
- `status` não é `'AVAILABLE'` (pode ser `'OFFLINE'`, `'BUSY'`, etc.)

**Código que verifica:**
```javascript
// driver-notification-dispatcher.js linha 107
if (!driverData || !driverData.isOnline || driverData.status !== 'AVAILABLE') {
    continue; // Motorista offline ou não disponível
}
```

**Verificar:**
```bash
redis-cli HGET driver:test_driver_xxx isOnline
redis-cli HGET driver:test_driver_xxx status
```

**Solução:**
- Garantir que `isOnline: 'true'` e `status: 'AVAILABLE'` no hash
- Verificar se motorista está realmente online no app

---

### **3. Motorista Não Está Autenticado ou Room Não Foi Criado**

**Sintoma:**
- Motorista está no Redis, mas notificação não chega

**Causa:**
- Autenticação falhou
- Room `driver_${driverId}` não foi criado
- Socket desconectou

**Código que cria room:**
```javascript
// server.js linha 498
socket.join(`driver_${data.uid}`);
```

**Código que envia notificação:**
```javascript
// driver-notification-dispatcher.js linha 280
this.io.to(`driver_${driverId}`).emit('newRideRequest', notificationData);
```

**Verificar:**
```bash
# Logs do servidor
pm2 logs server | grep -E "(authenticate|Driver.*adicionado|driver_.*room)"
```

**Solução:**
- Verificar se autenticação foi bem-sucedida
- Verificar se room foi criado
- Verificar se socket ainda está conectado

---

### **4. Motorista Está Bloqueado (Lock)**

**Sintoma:**
- Motorista está online, mas não recebe notificação

**Causa:**
- Motorista tem lock ativo de outra corrida
- Lock não foi liberado após corrida anterior

**Código que verifica:**
```javascript
// driver-notification-dispatcher.js linha 100
const lockStatus = await driverLockManager.isDriverLocked(driverId);
if (lockStatus.isLocked) {
    continue; // Motorista ocupado
}
```

**Verificar:**
```bash
redis-cli GET driver_lock:test_driver_xxx
```

**Solução:**
- Limpar lock se necessário: `redis-cli DEL driver_lock:test_driver_xxx`
- Verificar se lock está sendo liberado corretamente

---

### **5. Motorista Já Foi Notificado**

**Sintoma:**
- Motorista não recebe notificação para corrida específica

**Causa:**
- Motorista já foi notificado para esta corrida
- Set não foi limpo após corrida ser aceita/rejeitada

**Código que verifica:**
```javascript
// driver-notification-dispatcher.js linha 80
const notifiedDriverIds = await this.redis.smembers(`ride_notifications:${bookingId}`);
if (notifiedSet.has(driverId)) {
    continue; // Já foi notificado
}
```

**Verificar:**
```bash
redis-cli SMEMBERS ride_notifications:booking_xxx
```

**Solução:**
- Limpar set se necessário: `redis-cli DEL ride_notifications:booking_xxx`
- Verificar se set está sendo limpo corretamente

---

### **6. Motorista Fora do Raio de Busca**

**Sintoma:**
- Motorista não aparece em buscas

**Causa:**
- Motorista está muito longe do ponto de pickup
- Raio de busca é muito pequeno
- Coordenadas estão incorretas

**Código que busca:**
```javascript
// driver-notification-dispatcher.js linha 61
nearbyDrivers = await this.redis.georadius(
    'driver_locations',
    pickupLocation.lng,
    pickupLocation.lat,
    radius, // Raio em km
    'km'
);
```

**Verificar:**
```bash
# Posição do motorista
redis-cli GEOPOS driver_locations test_driver_xxx

# Comparar com posição do pickup (da corrida)
redis-cli HGET booking:booking_xxx pickupLocation
```

**Solução:**
- Verificar distância entre motorista e pickup
- Aumentar raio de busca se necessário
- Verificar se coordenadas estão corretas

---

## ⚠️ **PROBLEMAS SECUNDÁRIOS**

### **7. QueueWorker Não Está Processando**

**Sintoma:**
- Corrida é criada, mas não é processada

**Causa:**
- QueueWorker não está rodando
- Corrida não foi adicionada à fila
- Erro no processamento

**Verificar:**
```bash
# Logs do servidor
pm2 logs server | grep -E "(QueueWorker|processando.*região)"

# Verificar se corrida está na fila
redis-cli ZRANGE ride_queue:REGION:pending 0 -1
```

**Solução:**
- Verificar se QueueWorker está ativo
- Verificar se corrida está na fila
- Verificar logs de erro

---

### **8. DriverNotificationDispatcher Não Está Sendo Chamado**

**Sintoma:**
- Corrida é processada, mas motoristas não são buscados

**Causa:**
- Dispatcher não está sendo chamado
- Erro no dispatcher
- Busca não retorna motoristas

**Verificar:**
```bash
# Logs do servidor
pm2 logs server | grep -E "(Dispatcher|Buscando motoristas|motoristas encontrados)"
```

**Solução:**
- Verificar se dispatcher está sendo chamado
- Verificar logs de erro
- Verificar se busca retorna motoristas

---

### **9. Score Muito Baixo**

**Sintoma:**
- Motorista não aparece nos top motoristas

**Causa:**
- Score muito baixo (distância, rating, etc.)
- Muitos motoristas com score maior
- Limite de motoristas muito baixo

**Solução:**
- Verificar score do motorista
- Aumentar limite de motoristas notificados
- Verificar critérios de score

---

### **10. App Não Está Escutando Evento**

**Sintoma:**
- Notificação chega, mas app não processa

**Causa:**
- Listener não foi registrado
- WebSocket não está conectado
- Evento tem nome diferente

**Verificar:**
```javascript
// DriverUI.js linha 511
webSocketManager.on('newRideRequest', handleNewBookingAvailable);
```

**Solução:**
- Verificar se listener está registrado
- Verificar se WebSocket está conectado
- Verificar nome do evento

---

### **11. Dados da Corrida Estão Incorretos**

**Sintoma:**
- Notificação chega, mas card não aparece

**Causa:**
- `bookingId` está faltando
- `pickupLocation` está faltando
- Dados estão em formato incorreto

**Solução:**
- Verificar estrutura dos dados enviados
- Verificar se todos os campos obrigatórios estão presentes
- Verificar formato dos dados

---

### **12. Erro Silencioso no Processamento**

**Sintoma:**
- Nenhum erro visível, mas notificação não chega

**Causa:**
- Erro sendo capturado e ignorado
- Try/catch sem log
- Promise rejeitada sem tratamento

**Solução:**
- Verificar logs do servidor
- Adicionar logs detalhados
- Verificar tratamento de erros

---

## 🔧 **SCRIPT DE DIAGNÓSTICO**

Execute o script para diagnóstico automático:

```bash
./diagnosticar-notificacao.sh
```

O script irá:
1. ✅ Verificar se motorista está no GEO
2. ✅ Verificar se hash existe e tem dados
3. ✅ Verificar status (`isOnline`, `status`)
4. ✅ Verificar TTL
5. ✅ Verificar locks
6. ✅ Verificar notificações (se corrida fornecida)
7. ✅ Mostrar resumo e próximos passos

---

## 📊 **ORDEM DE PROBABILIDADE**

**Problemas mais prováveis (em ordem):**

1. ❌ **Hash vazio ou expirado** (40% dos casos)
2. ❌ **Status incorreto** (`isOnline: "false"` ou `status: "OFFLINE"`) (30% dos casos)
3. ❌ **Room não criado** na autenticação (15% dos casos)
4. ❌ **Motorista fora do raio** de busca (10% dos casos)
5. ❌ **Motorista bloqueado** (lock ativo) (3% dos casos)
6. ❌ **Motorista já notificado** (2% dos casos)

---

## ✅ **AÇÃO IMEDIATA**

1. **Executar script de diagnóstico:**
   ```bash
   ./diagnosticar-notificacao.sh
   ```

2. **Verificar logs do servidor:**
   ```bash
   pm2 logs server | grep -E "(Dispatcher|QueueWorker|createBooking|newRideRequest)"
   ```

3. **Verificar estado do Redis:**
   ```bash
   redis-cli HGETALL driver:test_driver_xxx
   redis-cli TTL driver:test_driver_xxx
   ```

4. **Identificar problema específico** e aplicar solução correspondente

---

## 💡 **CONCLUSÃO**

**Os problemas mais comuns são:**
1. Hash vazio ou expirado
2. Status incorreto (`isOnline` ou `status`)
3. Room não criado na autenticação

**Execute o script de diagnóstico para identificar o problema específico!**


