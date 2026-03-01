# 📋 Critérios e Validações para Reconhecimento de Corrida

## 🎯 Objetivo
Listar todos os critérios e condições que devem ser satisfeitas para que uma corrida seja criada, processada e reconhecida nos dispositivos (passageiro e motorista).

---

## 1️⃣ CRIAÇÃO DA CORRIDA (PASSAGEIRO)

### ✅ Validações no App (PassengerUI.js)

#### 1.1 Dados Obrigatórios
- [ ] **`auth.uid`** deve existir (usuário autenticado no Firebase)
- [ ] **`tripdata.pickup.add`** deve existir (endereço de origem)
- [ ] **`tripdata.drop.add`** deve existir (endereço de destino)
- [ ] **`tripdata.pickup.lat`** deve existir (latitude origem)
- [ ] **`tripdata.pickup.lng`** deve existir (longitude origem)
- [ ] **`tripdata.drop.lat`** deve existir (latitude destino)
- [ ] **`tripdata.drop.lng`** deve existir (longitude destino)
- [ ] **`carEstimates[selectedCarType.name]?.estimateFare`** deve existir (estimativa de preço)

#### 1.2 WebSocket - Conexão e Autenticação
- [ ] WebSocket deve estar conectado (`webSocketManager.isConnected()`)
- [ ] Autenticação deve ser bem-sucedida:
  - Evento: `authenticate` com `{ uid: auth.uid, userType: 'passenger' }`
  - Resposta: `authenticated` com `{ success: true }`
  - Timeout: 10 segundos
  - Retries: até 3 tentativas

#### 1.3 Dados Enviados ao Servidor
```javascript
{
    customerId: auth.uid,              // ✅ OBRIGATÓRIO
    pickupLocation: {
        lat: number,                   // ✅ OBRIGATÓRIO
        lng: number,                   // ✅ OBRIGATÓRIO
        add: string                    // ✅ OBRIGATÓRIO
    },
    destinationLocation: {
        lat: number,                   // ✅ OBRIGATÓRIO
        lng: number,                   // ✅ OBRIGATÓRIO
        add: string                    // ✅ OBRIGATÓRIO
    },
    estimatedFare: number,             // ✅ OBRIGATÓRIO
    carType: string,                   // Opcional
    paymentMethod: string              // Default: 'pix'
}
```

---

## 2️⃣ PROCESSAMENTO NO SERVIDOR

### ✅ Validações no Servidor (server.js - createBooking)

#### 2.1 Validação de Dados Recebidos
- [ ] **`customerId`** deve existir
- [ ] **`pickupLocation`** deve existir
- [ ] **`destinationLocation`** deve existir
- [ ] Se qualquer um faltar → emite `bookingError` e retorna

#### 2.2 Geração de ID de Corrida
```javascript
const bookingId = `booking_${Date.now()}_${customerId}`;
```
- [ ] **Formato:** `booking_TIMESTAMP_CUSTOMERID`
- [ ] **Exemplo:** `booking_1762702169407_test_passenger_123`
- [ ] **Unicidade:** Garantida por timestamp + customerId

#### 2.3 Conexão Redis
- [ ] Redis deve estar conectado (`redis.status === 'ready' || 'connect'`)
- [ ] Se não conectado, tenta conectar
- [ ] Se falhar → emite `bookingError` e retorna

#### 2.4 Armazenamento no Redis
- [ ] **Hash:** `booking:${bookingId}` com dados completos
- [ ] **Estado:** `RideStateManager.STATES.PENDING`
- [ ] **Fila Regional:** Adicionado à `ride_queue:${regionHash}:pending`
- [ ] **ActiveBookings:** Adicionado ao Map `io.activeBookings`

#### 2.5 Resposta ao Passageiro
- [ ] Emite `bookingCreated` com:
```javascript
{
    success: true,
    bookingId: string,
    message: 'Corrida solicitada com sucesso',
    data: {
        bookingId,
        customerId,
        pickupLocation,
        destinationLocation,
        estimatedFare,
        paymentMethod,
        status: 'requested',
        timestamp: ISO string
    }
}
```

---

## 3️⃣ PROCESSAMENTO PELA FILA (QueueWorker)

### ✅ Condições para Processamento

#### 3.1 QueueWorker
- [ ] QueueWorker deve estar rodando (processa a cada 3 segundos)
- [ ] Corrida deve estar na fila: `ride_queue:${regionHash}:pending`
- [ ] Estado deve ser `PENDING`

#### 3.2 GradualRadiusExpander
- [ ] Busca motoristas em raio gradual (0.5km → 1km → 2km → 5km)
- [ ] Usa `DriverNotificationDispatcher.findAndScoreDrivers()`

---

## 4️⃣ BUSCA DE MOTORISTAS

### ✅ Critérios para Motorista Ser Encontrado

#### 4.1 Motorista no Redis GEO
- [ ] Motorista deve estar em `driver_locations` (GEO set)
- [ ] Localização deve estar dentro do raio de busca (0.5-5km)
- [ ] Comando: `redis.georadius('driver_locations', lng, lat, radius, 'km')`

#### 4.2 Status do Motorista
- [ ] **`isOnline`** deve ser `'true'` (string)
- [ ] **`status`** deve ser `'AVAILABLE'`
- [ ] Dados em: `driver:${driverId}` (Redis hash)

#### 4.3 Filtros Aplicados
- [ ] Motorista **NÃO** deve estar em `ride_notifications:${bookingId}` (já notificado)
- [ ] Motorista **NÃO** deve estar com lock ativo (`driverLockManager.isDriverLocked()`)
- [ ] Motorista deve estar no room correto: `driver_${driverId}`

#### 4.4 Cálculo de Score
- [ ] Score calculado com:
  - Distância: 40%
  - Rating: 20%
  - Acceptance Rate: 20%
  - Response Time: 20%
- [ ] Motoristas ordenados por score (maior primeiro)

---

## 5️⃣ NOTIFICAÇÃO AO MOTORISTA

### ✅ Condições para Notificação Ser Enviada

#### 5.1 Lock Manager
- [ ] Lock deve ser adquirido: `driverLockManager.acquireLock(driverId, bookingId, 15)`
- [ ] Se lock não adquirido → motorista não é notificado

#### 5.2 Verificação de Duplicatas
- [ ] Motorista **NÃO** deve estar em `ride_notifications:${bookingId}`
- [ ] Se já notificado → retorna `false`

#### 5.3 Envio via WebSocket
- [ ] Evento: `newRideRequest`
- [ ] Room: `driver_${driverId}`
- [ ] Payload:
```javascript
{
    rideId: bookingId,
    bookingId: bookingId,
    customerId: string,
    pickupLocation: { lat, lng, add },
    destinationLocation: { lat, lng, add },
    estimatedFare: number,
    paymentMethod: string,
    timeout: 15,
    timestamp: ISO string
}
```

#### 5.4 Registro de Notificação
- [ ] Adicionado a `ride_notifications:${bookingId}` (Redis Set)
- [ ] Timeout de 15 segundos agendado

---

## 6️⃣ RECEPÇÃO NO APP DO MOTORISTA

### ✅ Validações no App (DriverUI.js)

#### 6.1 Eventos Escutados
- [ ] `newRideRequest` (principal - do DriverNotificationDispatcher)
- [ ] `rideRequest` (compatibilidade)
- [ ] `newBookingAvailable` (compatibilidade)

#### 6.2 Normalização de Dados
- [ ] Função `normalizeBookingData(data)` extrai:
  - `bookingId` (de `rideId` ou `bookingId`)
  - `pickup` (com `add`, `lat`, `lng`)
  - `drop` (com `add`, `lat`, `lng`)
  - `estimate` (valor da corrida)

#### 6.3 Validação Crítica
- [ ] **`bookingId`** deve existir após normalização
- [ ] Se não existir → log de erro e retorna (não exibe card)

#### 6.4 Exibição do Card
- [ ] Card só é exibido se:
  - `bookingId` existe
  - `pickup.add` existe
  - `drop.add` existe
  - `estimate` existe

---

## 7️⃣ AUTENTICAÇÃO E CONEXÃO

### ✅ Passageiro

#### 7.1 Autenticação Firebase
- [ ] Usuário deve estar autenticado no Firebase
- [ ] `auth.uid` deve existir

#### 7.2 Autenticação WebSocket
- [ ] Evento `authenticate` enviado com `{ uid: auth.uid, userType: 'passenger' }`
- [ ] Resposta `authenticated` recebida com `success: true`
- [ ] Socket adicionado ao room: `customer_${auth.uid}`

### ✅ Motorista

#### 7.3 Autenticação Firebase
- [ ] Usuário deve estar autenticado no Firebase
- [ ] `auth.uid` deve existir

#### 7.4 Autenticação WebSocket
- [ ] Evento `authenticate` enviado com `{ uid: auth.uid, userType: 'driver' }`
- [ ] Resposta `authenticated` recebida com `success: true`
- [ ] Socket adicionado aos rooms:
  - `drivers_room`
  - `driver_${auth.uid}` (CRÍTICO para receber notificações)

#### 7.5 Localização do Motorista
- [ ] Motorista deve enviar localização: `updateLocation` ou `updateDriverLocation`
- [ ] Localização salva em:
  - `driver_locations` (GEO set) - se online
  - `driver:${driverId}` (hash) - status completo

---

## 8️⃣ POSSÍVEIS PROBLEMAS COM USUÁRIOS DE TESTE

### ⚠️ Problemas Identificados

#### 8.1 Autenticação
- [ ] **Problema:** Usuário de teste pode não ter `auth.uid` válido
- [ ] **Solução:** Verificar se Firebase Auth está funcionando

#### 8.2 Room do Motorista
- [ ] **Problema:** Motorista pode não estar no room `driver_${driverId}`
- [ ] **Verificar:** Logs do servidor devem mostrar: `🚗 Driver ${driverId} adicionado ao room de drivers e driver_${driverId}`

#### 8.3 Localização do Motorista
- [ ] **Problema:** Motorista pode não estar no Redis GEO
- [ ] **Verificar:** 
  ```bash
  redis-cli ZRANGE driver_locations 0 -1 WITHSCORES
  ```
- [ ] **Verificar status:**
  ```bash
  redis-cli HGETALL driver:${driverId}
  ```

#### 8.4 Estado do Motorista
- [ ] **Problema:** `isOnline` pode ser `'false'` ou `status` pode ser diferente de `'AVAILABLE'`
- [ ] **Verificar:** Hash `driver:${driverId}` deve ter:
  - `isOnline: 'true'`
  - `status: 'AVAILABLE'`

#### 8.5 Lock do Motorista
- [ ] **Problema:** Motorista pode estar com lock ativo (ocupado)
- [ ] **Verificar:** `driverLockManager.isDriverLocked(driverId)`

#### 8.6 QueueWorker
- [ ] **Problema:** QueueWorker pode não estar processando
- [ ] **Verificar:** Logs devem mostrar processamento a cada 3 segundos

#### 8.7 Dados da Corrida
- [ ] **Problema:** `pickupLocation` ou `destinationLocation` podem não ter `add` (endereço)
- [ ] **Verificar:** App do passageiro deve enviar `add` em ambos

#### 8.8 Normalização no Motorista
- [ ] **Problema:** `normalizeBookingData` pode não encontrar `bookingId`
- [ ] **Verificar:** Logs devem mostrar: `❌ Booking sem ID (mesmo após normalização)`

---

## 9️⃣ CHECKLIST DE DEBUGGING

### Para Passageiro (Criar Corrida)

1. [ ] Firebase Auth funcionando? (`auth.uid` existe?)
2. [ ] WebSocket conectado? (`webSocketManager.isConnected()`)
3. [ ] Autenticação WebSocket OK? (evento `authenticated` recebido)
4. [ ] Dados completos? (`pickup.add`, `drop.add`, `lat`, `lng`)
5. [ ] Evento `createBooking` enviado?
6. [ ] Resposta `bookingCreated` recebida?
7. [ ] `bookingId` retornado?

### Para Motorista (Receber Notificação)

1. [ ] Firebase Auth funcionando? (`auth.uid` existe?)
2. [ ] WebSocket conectado?
3. [ ] Autenticação WebSocket OK? (evento `authenticated` recebido)
4. [ ] Motorista no room correto? (`driver_${driverId}`)
5. [ ] Localização enviada? (`updateLocation` chamado)
6. [ ] Motorista no Redis GEO? (`driver_locations`)
7. [ ] Status correto? (`isOnline: 'true'`, `status: 'AVAILABLE'`)
8. [ ] Motorista não está com lock?
9. [ ] Motorista não foi notificado antes? (`ride_notifications:${bookingId}`)
10. [ ] Evento `newRideRequest` recebido?
11. [ ] `bookingId` existe após normalização?
12. [ ] Card exibido?

### Para Servidor

1. [ ] Redis conectado?
2. [ ] QueueWorker rodando? (logs a cada 3s)
3. [ ] Corrida criada no Redis? (`booking:${bookingId}`)
4. [ ] Corrida na fila? (`ride_queue:${regionHash}:pending`)
5. [ ] Motoristas encontrados? (logs do Dispatcher)
6. [ ] Notificação enviada? (logs: `📱 Notificação enviada para driver`)
7. [ ] Motorista registrado como notificado? (`ride_notifications:${bookingId}`)

---

## 🔟 COMANDOS ÚTEIS PARA VERIFICAÇÃO

### Redis
```bash
# Ver motoristas online
redis-cli ZRANGE driver_locations 0 -1 WITHSCORES

# Ver status de um motorista
redis-cli HGETALL driver:${driverId}

# Ver corrida criada
redis-cli HGETALL booking:${bookingId}

# Ver motoristas notificados
redis-cli SMEMBERS ride_notifications:${bookingId}

# Ver fila de corridas
redis-cli ZRANGE ride_queue:${regionHash}:pending 0 -1
```

### Logs do Servidor
```bash
# Verificar autenticação
grep "autenticado" logs.txt

# Verificar criação de corrida
grep "Solicitação de corrida recebida" logs.txt

# Verificar busca de motoristas
grep "Buscando motoristas" logs.txt

# Verificar notificação
grep "Notificação enviada para driver" logs.txt
```

---

## 📝 RESUMO DOS CRITÉRIOS CRÍTICOS

### ✅ Para Corrida Ser Criada:
1. Passageiro autenticado (Firebase + WebSocket)
2. Dados completos (origem, destino, preço)
3. Redis conectado
4. ID gerado: `booking_${timestamp}_${customerId}`

### ✅ Para Motorista Receber Notificação:
1. Motorista autenticado (Firebase + WebSocket)
2. Motorista no room `driver_${driverId}`
3. Motorista online e disponível (`isOnline: 'true'`, `status: 'AVAILABLE'`)
4. Motorista no Redis GEO (`driver_locations`)
5. Motorista dentro do raio de busca
6. Motorista sem lock ativo
7. Motorista não foi notificado antes
8. QueueWorker processou a corrida
9. DriverNotificationDispatcher encontrou o motorista
10. Notificação enviada para o room correto

### ✅ Para Card Ser Exibido:
1. Evento `newRideRequest` recebido
2. `bookingId` existe após normalização
3. `pickup.add` e `drop.add` existem
4. `estimate` existe

---

## ⚠️ PONTOS DE ATENÇÃO COM USUÁRIOS DE TESTE

1. **IDs de teste podem não seguir padrão esperado**
   - Verificar se `auth.uid` é válido
   - Verificar se não há caracteres especiais

2. **Autenticação pode falhar silenciosamente**
   - Verificar logs do servidor
   - Verificar resposta do evento `authenticated`

3. **Localização pode não ser salva**
   - Verificar se `updateLocation` está sendo chamado
   - Verificar se Redis está recebendo os dados

4. **Room pode não ser criado**
   - Verificar logs: `Driver ${driverId} adicionado ao room`
   - Verificar se `socket.userType === 'driver'`

5. **Dados podem estar em formato incorreto**
   - Verificar se `pickupLocation` tem `add` (endereço)
   - Verificar se coordenadas são números válidos


