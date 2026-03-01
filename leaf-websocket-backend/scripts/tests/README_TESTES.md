# 🧪 GUIA DE TESTES - EVENTOS E LISTENERS

Este diretório contém scripts para testar eventos WebSocket e listeners.

---

## 📋 Scripts Disponíveis

### 1. `test-eventos-listeners-completo.js`
**Teste completo do fluxo de corrida**

Testa todos os eventos do fluxo completo:
- ✅ Autenticação
- ✅ Status do motorista
- ✅ Criação de booking
- ✅ Notificação de corrida
- ✅ Aceitação de corrida
- ✅ Pagamento
- ✅ Início de viagem
- ✅ Finalização de viagem
- ✅ Avaliação

**Uso:**
```bash
cd leaf-websocket-backend
node scripts/tests/test-eventos-listeners-completo.js
```

**Variáveis de Ambiente:**
```bash
WS_URL=http://localhost:3001 node scripts/tests/test-eventos-listeners-completo.js
```

---

### 2. `test-listeners-simples.js`
**Teste simples de listeners**

Verifica se os listeners estão registrados e podem receber eventos.

**Uso:**
```bash
cd leaf-websocket-backend
node scripts/tests/test-listeners-simples.js
```

---

## 🚀 Como Executar

### Pré-requisitos

1. **Servidor WebSocket rodando:**
   ```bash
   cd leaf-websocket-backend
   npm start
   # ou
   node server.js
   ```

2. **Redis rodando:**
   ```bash
   redis-server
   ```

3. **Firestore configurado** (ou mock)

### Executar Testes

```bash
# Teste completo
node scripts/tests/test-eventos-listeners-completo.js

# Teste simples de listeners
node scripts/tests/test-listeners-simples.js
```

---

## 📊 Interpretando os Resultados

### Teste Completo

O script gera um relatório com:

1. **Estatísticas:**
   - Total de testes executados
   - Testes passados ✅
   - Testes falhados ❌
   - Taxa de sucesso

2. **Eventos Emitidos:**
   - Lista de todos os eventos enviados ao servidor

3. **Eventos Recebidos:**
   - Passageiro: eventos recebidos
   - Motorista: eventos recebidos

4. **Eventos Esperados vs Recebidos:**
   - Comparação entre eventos esperados e realmente recebidos

### Exemplo de Saída

```
🧪 INICIANDO TESTES DE EVENTOS E LISTENERS

📋 TESTE 1: AUTENTICAÇÃO
✅ Autenticação: PASSED

📋 TESTE 2: STATUS DO MOTORISTA
✅ Status do Motorista: PASSED

📋 TESTE 3: CRIAÇÃO DE BOOKING
✅ Criação de Booking: PASSED (bookingId: booking_1234567890_customer_test_001)

...

================================================================================
📊 RELATÓRIO FINAL DE TESTES
================================================================================

Estatísticas:
  Total de Testes: 9
  ✅ Passed: 8
  ❌ Failed: 1
  Taxa de Sucesso: 88.89%

Eventos Emitidos: 12
  - authenticate (customer_test_001)
  - setDriverStatus (driver_test_001)
  - createBooking (customer_test_001)
  ...

Eventos Recebidos pelo Passageiro:
  - authenticated (1x)
  - bookingCreated (1x)
  - rideAccepted (1x)
  ...

Eventos Recebidos pelo Motorista:
  - authenticated (1x)
  - driverStatusUpdated (1x)
  - newRideRequest (1x)
  ...
```

---

## 🔍 Troubleshooting

### Erro: "Timeout de conexão"

**Causa:** Servidor WebSocket não está rodando ou não está acessível.

**Solução:**
1. Verificar se o servidor está rodando:
   ```bash
   curl http://localhost:3001/health
   ```

2. Verificar a URL do WebSocket:
   ```bash
   WS_URL=http://seu-servidor:3001 node scripts/tests/test-eventos-listeners-completo.js
   ```

### Erro: "Autenticação falhou"

**Causa:** Servidor não está processando eventos de autenticação.

**Solução:**
1. Verificar logs do servidor
2. Verificar se Redis está conectado
3. Verificar se Firestore está configurado

### Eventos não recebidos

**Causa:** Listeners não estão registrados ou eventos não estão sendo emitidos.

**Solução:**
1. Verificar logs do servidor para ver se eventos estão sendo emitidos
2. Verificar se os rooms estão corretos (`io.to('driver_${driverId}')`)
3. Verificar se o QueueWorker está processando corridas

### Timeout em eventos específicos

**Causa:** Processamento demorado (ex: QueueWorker, busca de motoristas).

**Solução:**
1. Aumentar timeout no teste:
   ```javascript
   await driver.expectEvent('newRideRequest', 1, 20000); // 20s
   ```

2. Verificar se QueueWorker está rodando
3. Verificar se há motoristas disponíveis no Redis

---

## 📝 Adicionando Novos Testes

Para adicionar um novo teste:

1. **Criar função de teste:**
   ```javascript
   async function testNovoEvento(client, data) {
       log.test('\n📋 TESTE X: NOVO EVENTO');
       stats.total++;
       
       try {
           const response = await client.emitAndWait(
               'novoEvento',
               data,
               'novoEventoResponse',
               5000
           );
           
           if (!response || !response.success) {
               throw new Error('Falha no novo evento');
           }
           
           log.success('✅ Novo Evento: PASSED');
           stats.passed++;
       } catch (error) {
           log.error(`❌ Novo Evento: FAILED - ${error.message}`);
           stats.failed++;
       }
   }
   ```

2. **Adicionar ao fluxo principal:**
   ```javascript
   await testNovoEvento(customer, { ... });
   ```

---

## 🎯 Eventos Testados

### Passageiro (Customer)
- ✅ `authenticate` → `authenticated`
- ✅ `createBooking` → `bookingCreated`
- ✅ `confirmPayment` → `paymentConfirmed`
- ✅ `cancelRide` → `rideCancelled`
- ✅ `submitRating` → `ratingSubmitted`
- ✅ Recebe: `rideAccepted`, `tripStarted`, `tripCompleted`, `driverLocation`

### Motorista (Driver)
- ✅ `authenticate` → `authenticated`
- ✅ `setDriverStatus` → `driverStatusUpdated`
- ✅ `updateLocation` → `locationUpdated`
- ✅ `acceptRide` → `rideAccepted`
- ✅ `startTrip` → `tripStarted`
- ✅ `completeTrip` → `tripCompleted`
- ✅ `submitRating` → `ratingSubmitted`
- ✅ Recebe: `newRideRequest`, `paymentDistributed`

---

## 📚 Referências

- [Documentação de Eventos](../docs/ANALISE_EVENTOS_ESTADOS_QUERIES.md)
- [Relatório Completo de Telas e Eventos](../../docs/RELATORIO_COMPLETO_TELAS_EVENTOS.md)
- [Diagramas Mermaid](../../docs/DIAGRAMAS_MERMAID_PUROS.md)

---

**Última atualização:** 2025-01-29

