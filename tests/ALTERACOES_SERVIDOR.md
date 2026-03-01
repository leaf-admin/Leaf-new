# 🔧 ALTERAÇÕES NO SERVIDOR PARA TESTES

## ✅ **RESPOSTA CURTA: NÃO É NECESSÁRIO ALTERAR O SERVIDOR**

Os testes foram criados para usar **exatamente os mesmos eventos** que o app mobile já usa, então **nenhuma alteração é necessária** no servidor principal.

---

## 📋 **EVENTOS USADOS PELOS TESTES**

Os testes usam os seguintes eventos que **já devem existir** no servidor:

### **1. Autenticação** ✅
- **Evento:** `authenticate`
- **Payload:** `{ uid, userType }`
- **Resposta:** `authenticated` com `{ success: true, uid }`

### **2. Criar Booking** ✅
- **Evento:** `createBooking`
- **Payload:** `{ pickupLocation, destinationLocation, vehicleType, estimatedFare, ... }`
- **Resposta:** `bookingCreated` com `{ success: true, bookingId, ... }`

### **3. Driver Response** ✅
- **Evento:** `driverResponse`
- **Payload:** `{ bookingId, accepted, reason }`
- **Resposta:** `rideAccepted` ou `rideRejected`

### **4. Aceitar/Rejeitar Corrida** ✅
- **Eventos:** `acceptRide`, `rejectRide`
- **Payloads:** `{ rideId, ... }` ou `{ rideId, reason }`
- **Respostas:** `rideAccepted` ou `rideRejected`

### **5. Iniciar Viagem** ✅
- **Evento:** `startTrip`
- **Payload:** `{ bookingId, startLocation }`
- **Resposta:** `tripStarted`

### **6. Atualizar Localização** ✅
- **Evento:** `updateTripLocation`
- **Payload:** `{ bookingId, lat, lng, heading, speed }`
- **Resposta:** Nenhuma (evento fire-and-forget)

### **7. Completar Viagem** ✅
- **Evento:** `completeTrip`
- **Payload:** `{ bookingId, endLocation, distance, fare }`
- **Resposta:** `tripCompleted`

### **8. Confirmar Pagamento** ✅
- **Evento:** `confirmPayment`
- **Payload:** `{ bookingId, paymentMethod, paymentId, amount }`
- **Resposta:** `paymentConfirmed`

---

## 🔍 **VERIFICAÇÃO NECESSÁRIA**

Antes de rodar os testes, verifique se o servidor principal (`server.js` na VPS) já implementa esses eventos.

### **Como Verificar:**

1. **Abra o `server.js` principal**
2. **Procure por `socket.on()` para cada evento acima**
3. **Se todos existirem:** ✅ Nenhuma alteração necessária
4. **Se algum faltar:** ⚠️ Adicione o handler correspondente

---

## ⚠️ **SE FALTAR ALGUM EVENTO**

Se o servidor não implementar algum dos eventos acima, você tem **2 opções**:

### **Opção 1: Adicionar Handler no Servidor (RECOMENDADO)**

Adicione o handler faltante no `server.js`:

```javascript
socket.on('nomeDoEvento', async (data) => {
    try {
        // Implementar lógica do evento
        socket.emit('respostaDoEvento', { success: true, ... });
    } catch (error) {
        socket.emit('respostaDoEvento', { 
            success: false, 
            error: error.message 
        });
    }
});
```

### **Opção 2: Pular Teste Temporariamente**

Se não quiser alterar o servidor agora, você pode:

1. Comentar o teste correspondente na suite
2. Marcar como `skipped` nos resultados
3. Implementar depois quando o servidor tiver o evento

---

## ✅ **CHECKLIST ANTES DE RODAR TESTES**

- [ ] Servidor já tem handler para `authenticate` ✅
- [ ] Servidor já tem handler para `createBooking` ✅
- [ ] Servidor já tem handler para `driverResponse` (ou `acceptRide`/`rejectRide`) ✅
- [ ] Servidor já tem handler para `startTrip` ✅
- [ ] Servidor já tem handler para `updateTripLocation` ✅
- [ ] Servidor já tem handler para `completeTrip` ✅
- [ ] Servidor já tem handler para `confirmPayment` ✅
- [ ] Servidor já emite eventos de resposta corretos (`authenticated`, `bookingCreated`, etc.) ✅

---

## 🧪 **TESTE RÁPIDO**

Você pode testar se o servidor está pronto executando apenas o teste de autenticação:

```bash
cd tests
node suites/01-autenticacao-identidade.test.js
```

Se passar, significa que pelo menos `authenticate` está funcionando. Se falhar com erro de conexão ou timeout, verifique:

1. URL do servidor está correta em `config/test-parameters.js`
2. Servidor está rodando na VPS
3. Firewall permite conexões WebSocket

---

## 📝 **OBSERVAÇÃO IMPORTANTE**

Os testes **NÃO modificam** o servidor - eles apenas **comunicam com ele** da mesma forma que o app mobile faria. Portanto:

- ✅ **Não há risco** de quebrar o servidor rodando os testes
- ✅ **Não há risco** de poluir dados reais (se você usar IDs de teste)
- ✅ **Testes podem rodar** em produção (mas não recomendado sem cuidado)

---

## 🎯 **RECOMENDAÇÃO**

**Para ambiente de produção:**
- Use um ambiente de **staging/test** separado
- Ou use IDs de teste que não conflitem com dados reais
- Ou configure o servidor para detectar testes e usar banco de dados de teste

**Para ambiente de desenvolvimento:**
- Pode rodar os testes direto no servidor local
- Os testes usarão dados de teste (IDs com prefixo `test-`)

---

## ✅ **CONCLUSÃO**

**Resposta:** **NÃO é necessário alterar o servidor** se ele já implementa os eventos que o app mobile usa (o que deveria ser o caso).

**Ação necessária:** Apenas **verificar** se todos os eventos estão implementados e, se não estiverem, adicionar os handlers faltantes.

---

**Última atualização:** 29/01/2025



