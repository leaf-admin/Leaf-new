# ✅ Checklist Completo: Diagnóstico de Notificação de Corrida

## 🎯 **OBJETIVO**

Identificar por que o motorista não está recebendo notificação quando o passageiro solicita uma corrida.

---

## 📋 **CHECKLIST DE VERIFICAÇÃO**

### **FASE 1: VERIFICAÇÃO DO MOTORISTA NO REDIS**

#### **1.1 Motorista está no GEO?**
```bash
redis-cli ZRANGE driver_locations 0 -1
# Deve listar todos os motoristas online
# Procurar por: test_driver_xxx ou test-user-dev-xxx
```

**✅ Passou:** Motorista aparece na lista  
**❌ Falhou:** Motorista NÃO está no GEO → Problema: Localização não está sendo salva

---

#### **1.2 Hash do motorista existe e tem dados?**
```bash
redis-cli HGETALL driver:test_driver_xxx
# Substituir test_driver_xxx pelo ID real do motorista
```

**Verificar:**
- ✅ Hash existe (não retorna vazio)
- ✅ `isOnline: "true"` (não `"false"` ou `undefined`)
- ✅ `status: "AVAILABLE"` (não `"OFFLINE"` ou `"BUSY"`)
- ✅ `lat` e `lng` existem e são válidos

**✅ Passou:** Hash existe com todos os campos  
**❌ Falhou:** Hash vazio ou campos faltando → Problema: `saveDriverLocation` não está salvando

---

#### **1.3 TTL do hash está válido?**
```bash
redis-cli TTL driver:test_driver_xxx
# Deve retornar: 0-90 segundos (online) ou 0-30 segundos (em viagem)
# -2 = não existe, -1 = sem TTL (problema)
```

**✅ Passou:** TTL entre 0-90 segundos  
**❌ Falhou:** TTL é -2 (não existe) ou -1 (sem TTL) → Problema: Hash expirou ou não tem TTL

---

#### **1.4 Posição GEO do motorista está correta?**
```bash
redis-cli GEOPOS driver_locations test_driver_xxx
# Deve retornar: [longitude, latitude]
```

**✅ Passou:** Retorna coordenadas válidas  
**❌ Falhou:** Retorna `(nil)` → Problema: Motorista não está no GEO

---

### **FASE 2: VERIFICAÇÃO DA AUTENTICAÇÃO**

#### **2.1 Motorista está autenticado?**
```bash
# Verificar logs do servidor
pm2 logs server | grep -E "(authenticate|Motorista autenticado|test_driver)"
```

**Procurar por:**
- `🔐 Motorista autenticado: test_driver_xxx`
- `✅ Motorista autenticado com sucesso`

**✅ Passou:** Log mostra autenticação bem-sucedida  
**❌ Falhou:** Não aparece log de autenticação → Problema: Autenticação falhou

---

#### **2.2 Room do motorista foi criado?**
```bash
# Verificar logs do servidor
pm2 logs server | grep -E "(driver_.*adicionado|join.*driver)"
```

**Procurar por:**
- `🚗 Driver test_driver_xxx adicionado ao room de drivers e driver_test_driver_xxx`

**✅ Passou:** Log mostra room criado  
**❌ Falhou:** Não aparece log → Problema: Room não foi criado na autenticação

---

#### **2.3 Socket está conectado?**
**No app do motorista:**
- Verificar se WebSocket está conectado
- Verificar se autenticação foi bem-sucedida

**✅ Passou:** WebSocket conectado e autenticado  
**❌ Falhou:** WebSocket desconectado → Problema: Conexão perdida

---

### **FASE 3: VERIFICAÇÃO DA CORRIDA**

#### **3.1 Corrida foi criada?**
```bash
# Verificar se corrida foi criada
redis-cli KEYS "booking:*" | head -5
```

**✅ Passou:** Corrida aparece na lista  
**❌ Falhou:** Nenhuma corrida encontrada → Problema: `createBooking` não está criando corrida

---

#### **3.2 Dados da corrida estão completos?**
```bash
redis-cli HGETALL booking:booking_xxx
# Substituir booking_xxx pelo ID real da corrida
```

**Verificar:**
- ✅ `bookingId` existe
- ✅ `customerId` existe
- ✅ `pickupLocation` existe (JSON válido)
- ✅ `destinationLocation` existe (JSON válido)
- ✅ `status` existe

**✅ Passou:** Todos os campos presentes  
**❌ Falhou:** Campos faltando → Problema: Dados incompletos na criação

---

#### **3.3 Corrida está na fila?**
```bash
# Verificar região da corrida
redis-cli HGET booking:booking_xxx region

# Verificar se está na fila da região
redis-cli ZRANGE ride_queue:REGION:pending 0 -1
# Substituir REGION pelo hash da região retornado acima
```

**✅ Passou:** Corrida aparece na fila  
**❌ Falhou:** Corrida não está na fila → Problema: `enqueueRide` não está funcionando

---

### **FASE 4: VERIFICAÇÃO DO PROCESSAMENTO**

#### **4.1 QueueWorker está rodando?**
```bash
# Verificar logs do servidor
pm2 logs server | grep -E "(QueueWorker|processando.*região)"
```

**Procurar por:**
- `🚀 [QueueWorker] Worker iniciado`
- `📊 [QueueWorker] Processando X região(ões)`

**✅ Passou:** Logs mostram QueueWorker ativo  
**❌ Falhou:** Não aparece log → Problema: QueueWorker não está rodando

---

#### **4.2 QueueWorker está processando a corrida?**
```bash
# Verificar logs do servidor
pm2 logs server | grep -E "(processada|GradualRadiusExpander|iniciando busca)"
```

**Procurar por:**
- `✅ [QueueWorker] X corrida(s) processada(s)`
- `🚀 [GradualRadiusExpander] Iniciando busca gradual`

**✅ Passou:** Logs mostram processamento  
**❌ Falhou:** Não aparece log → Problema: QueueWorker não está processando

---

#### **4.3 DriverNotificationDispatcher está sendo chamado?**
```bash
# Verificar logs do servidor
pm2 logs server | grep -E "(Dispatcher|Buscando motoristas|motoristas encontrados)"
```

**Procurar por:**
- `🔍 [Dispatcher] Buscando motoristas`
- `✅ [Dispatcher] X motoristas encontrados`

**✅ Passou:** Logs mostram busca de motoristas  
**❌ Falhou:** Não aparece log → Problema: Dispatcher não está sendo chamado

---

### **FASE 5: VERIFICAÇÃO DA NOTIFICAÇÃO**

#### **5.1 Motorista foi encontrado na busca?**
```bash
# Verificar logs do servidor
pm2 logs server | grep -E "(motoristas encontrados|Score calculado|test_driver)"
```

**Procurar por:**
- `✅ [Dispatcher] X motoristas encontrados e pontuados`
- `📊 [Dispatcher] Score calculado para driver test_driver_xxx`

**✅ Passou:** Motorista aparece nos logs  
**❌ Falhou:** Motorista não aparece → Problema: Motorista não está sendo encontrado na busca

---

#### **5.2 Motorista passou nos filtros?**
**Verificar nos logs:**
- Motorista não está bloqueado (lock)
- Motorista está online e disponível
- Motorista não foi notificado anteriormente
- Motorista está dentro do raio de busca

**✅ Passou:** Motorista passou em todos os filtros  
**❌ Falhou:** Motorista foi filtrado → Problema: Verificar qual filtro está bloqueando

---

#### **5.3 Notificação foi enviada?**
```bash
# Verificar logs do servidor
pm2 logs server | grep -E "(notificar|newRideRequest|emit.*driver_)"
```

**Procurar por:**
- `✅ [Dispatcher] Motorista test_driver_xxx notificado para booking_xxx`
- `📱 Notificação enviada para driver test_driver_xxx`

**✅ Passou:** Log mostra notificação enviada  
**❌ Falhou:** Não aparece log → Problema: Notificação não está sendo enviada

---

#### **5.4 Motorista está no set de notificados?**
```bash
redis-cli SMEMBERS ride_notifications:booking_xxx
# Substituir booking_xxx pelo ID real da corrida
```

**✅ Passou:** Motorista aparece no set  
**❌ Falhou:** Motorista não aparece → Problema: Notificação não foi registrada

---

### **FASE 6: VERIFICAÇÃO NO APP DO MOTORISTA**

#### **6.1 Listener está registrado?**
**No código:**
```javascript
// DriverUI.js linha 511
webSocketManager.on('newRideRequest', handleNewBookingAvailable);
```

**✅ Passou:** Listener está registrado  
**❌ Falhou:** Listener não está registrado → Problema: App não está escutando evento

---

#### **6.2 WebSocket está conectado?**
**No app:**
- Verificar se `webSocketManager.isConnected()` retorna `true`
- Verificar se autenticação foi bem-sucedida

**✅ Passou:** WebSocket conectado  
**❌ Falhou:** WebSocket desconectado → Problema: Conexão perdida

---

#### **6.3 Evento está sendo recebido?**
**No app:**
- Adicionar log no `handleNewBookingAvailable`
- Verificar se função é chamada

**✅ Passou:** Função é chamada  
**❌ Falhou:** Função não é chamada → Problema: Evento não está chegando

---

#### **6.4 Dados estão completos?**
**No app:**
- Verificar se `data.bookingId` existe
- Verificar se `data.pickupLocation` existe
- Verificar se `data.destinationLocation` existe

**✅ Passou:** Todos os dados presentes  
**❌ Falhou:** Dados faltando → Problema: Dados incompletos na notificação

---

## 🔧 **COMANDOS DE DIAGNÓSTICO RÁPIDO**

### **Script Completo de Diagnóstico:**
```bash
#!/bin/bash

DRIVER_ID="test_driver_xxx"  # Substituir pelo ID real
BOOKING_ID="booking_xxx"     # Substituir pelo ID real da corrida

echo "=== DIAGNÓSTICO COMPLETO ==="
echo ""

echo "1. Motorista no GEO:"
redis-cli ZRANGE driver_locations 0 -1 | grep "$DRIVER_ID" && echo "✅" || echo "❌"

echo ""
echo "2. Hash do motorista:"
redis-cli HGETALL "driver:$DRIVER_ID" | head -10
TTL=$(redis-cli TTL "driver:$DRIVER_ID")
echo "TTL: $TTL segundos"
[ "$TTL" -gt 0 ] && echo "✅" || echo "❌"

echo ""
echo "3. Status do motorista:"
redis-cli HGET "driver:$DRIVER_ID" isOnline
redis-cli HGET "driver:$DRIVER_ID" status

echo ""
echo "4. Corrida criada:"
redis-cli KEYS "booking:$BOOKING_ID" && echo "✅" || echo "❌"

echo ""
echo "5. Corrida na fila:"
REGION=$(redis-cli HGET "booking:$BOOKING_ID" region)
echo "Região: $REGION"
redis-cli ZRANGE "ride_queue:$REGION:pending" 0 -1 | grep "$BOOKING_ID" && echo "✅" || echo "❌"

echo ""
echo "6. Motoristas notificados:"
redis-cli SMEMBERS "ride_notifications:$BOOKING_ID"

echo ""
echo "7. Lock do motorista:"
redis-cli GET "driver_lock:$DRIVER_ID"
```

---

## 🎯 **PROBLEMAS MAIS COMUNS**

### **1. Hash Vazio (Mais Comum)**
**Sintoma:** Motorista no GEO, mas hash vazio  
**Causa:** `saveDriverLocation` não está salvando hash  
**Solução:** Verificar se `updateLocation` está sendo recebido e processado

### **2. Status Incorreto**
**Sintoma:** Hash existe, mas `isOnline: "false"` ou `status: "OFFLINE"`  
**Causa:** Motorista não está realmente online  
**Solução:** Verificar se motorista está online no app

### **3. Room Não Criado**
**Sintoma:** Notificação não chega  
**Causa:** Room `driver_${driverId}` não foi criado  
**Solução:** Verificar autenticação e criação do room

### **4. Motorista Fora do Raio**
**Sintoma:** Motorista não aparece em buscas  
**Causa:** Motorista muito longe do pickup  
**Solução:** Verificar distância e aumentar raio se necessário

### **5. QueueWorker Não Processa**
**Sintoma:** Corrida criada, mas não processada  
**Causa:** QueueWorker não está rodando ou tem erro  
**Solução:** Verificar logs do QueueWorker

---

## 💡 **PRÓXIMOS PASSOS**

1. **Executar checklist completo** acima
2. **Identificar qual fase falhou**
3. **Aplicar solução específica** para o problema
4. **Testar novamente**

---

## 📊 **RESUMO**

**Problemas mais prováveis (em ordem):**
1. ❌ Hash vazio ou expirado (TTL)
2. ❌ Status incorreto (`isOnline: "false"` ou `status: "OFFLINE"`)
3. ❌ Room não criado na autenticação
4. ❌ Motorista fora do raio de busca
5. ❌ QueueWorker não está processando
6. ❌ Motorista bloqueado (lock)
7. ❌ Motorista já foi notificado
8. ❌ Listener não registrado no app

**Ação imediata:** Executar checklist e identificar qual fase está falhando.


