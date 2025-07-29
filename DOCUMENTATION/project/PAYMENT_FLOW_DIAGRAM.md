# 💰 **DIAGRAMA DO FLUXO DE PAGAMENTO ANTECIPADO - LEAF APP**

## 🎯 **ESTRATÉGIA: PAGAMENTO ANTECIPADO VIA PIX**

### **📋 OBJETIVOS:**
- ✅ **Evitar inadimplência:** Cliente paga antes da corrida
- ✅ **Garantir fundos:** Motorista recebe valor garantido
- ✅ **Simplificar processo:** Apenas PIX inicialmente
- ✅ **Cancelamento inteligente:** Devolução com regras claras

---

## 🔄 **FLUXO COMPLETO - DIAGRAMA**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LEAF APP - FLUXO DE PAGAMENTO                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CLIENTE       │    │   SISTEMA       │    │   WOOVI PIX     │
│                 │    │                 │    │                 │
│ 1. Define      │───▶│ 2. Calcula      │───▶│ 3. Gera         │
│    Destino      │    │    Valor        │    │    Cobrança     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CLIENTE       │    │   SISTEMA       │    │   WOOVI PIX     │
│                 │    │                 │    │                 │
│ 4. Recebe       │◀───│ 5. Exibe        │◀───│ 6. Retorna      │
│    QR Code      │    │    QR Code      │    │    QR Code      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        │                        │                        │
        ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CLIENTE       │    │   SISTEMA       │    │   WOOVI PIX     │
│                 │    │                 │    │                 │
│ 7. Escaneia     │───▶│ 8. Aguarda      │◀───│ 9. Processa     │
│    QR Code      │    │    Pagamento    │    │    Pagamento    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SISTEMA       │    │   MOTORISTAS    │    │   WOOVI PIX     │
│                 │    │                 │    │                 │
│ 10. Confirma    │───▶│ 11. Busca       │    │ 12. Webhook     │
│    Pagamento    │    │    Motoristas   │    │    Confirmação   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        │                        │                        │
        ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   MOTORISTA     │    │   SISTEMA       │    │   CLIENTE       │
│                 │    │                 │    │                 │
│ 13. Aceita      │───▶│ 14. Inicia      │───▶│ 15. Inicia      │
│    Corrida      │    │    Tracking     │    │    Viagem       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## 💰 **REGRAS DE CANCELAMENTO E DEVOLUÇÃO**

### **📊 TABELA DE TAXAS DE CANCELAMENTO:**

| **Momento do Cancelamento** | **Taxa de Cancelamento** | **Devolução ao Cliente** | **Comissão Leaf** |
|----------------------------|-------------------------|-------------------------|-------------------|
| **Antes do Pagamento** | 0% | 100% | 0% |
| **Após Pagamento, Antes de Motorista Aceitar** | 5% | 95% | 5% |
| **Motorista Aceitou, Antes de Iniciar Viagem** | 10% | 90% | 10% |
| **Viagem Iniciada, Primeiros 5 minutos** | 25% | 75% | 25% |
| **Viagem Iniciada, Após 5 minutos** | 50% | 50% | 50% |
| **Viagem Concluída** | 100% | 0% | 100% |

### **🔄 FLUXO DE CANCELAMENTO:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FLUXO DE CANCELAMENTO                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CLIENTE       │    │   SISTEMA       │    │   WOOVI PIX     │
│                 │    │                 │    │                 │
│ 1. Solicita     │───▶│ 2. Calcula      │───▶│ 3. Processa     │
│    Cancelamento │    │    Taxa         │    │    Devolução    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CLIENTE       │    │   SISTEMA       │    │   MOTORISTA     │
│                 │    │                 │    │                 │
│ 4. Recebe       │◀───│ 5. Notifica     │───▶│ 6. Libera       │
│    Devolução    │    │    Devolução    │    │    Motorista    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## 🔧 **IMPLEMENTAÇÃO TÉCNICA**

### **📱 FRONTEND (MOBILE APP):**

```javascript
// 1. TELA DE DESTINO E CÁLCULO
const calculateTrip = async (origin, destination) => {
    const response = await api.post('/calculate-trip', {
        origin,
        destination,
        paymentMethod: 'PIX_ONLY'
    });
    
    return {
        value: response.data.value,
        estimatedTime: response.data.estimatedTime,
        distance: response.data.distance
    };
};

// 2. TELA DE PAGAMENTO PIX
const generatePixPayment = async (tripData) => {
    const response = await api.post('/create-pix-charge', {
        value: tripData.value,
        correlationID: `trip_${Date.now()}`,
        comment: `Corrida Leaf - ${tripData.origin} → ${tripData.destination}`
    });
    
    return {
        qrCode: response.data.qrCodeImage,
        brCode: response.data.brCode,
        paymentLink: response.data.paymentLinkUrl
    };
};

// 3. MONITORAMENTO DE PAGAMENTO
const monitorPayment = async (chargeId) => {
    const interval = setInterval(async () => {
        const status = await api.get(`/payment-status/${chargeId}`);
        
        if (status.data.status === 'CONFIRMED') {
            clearInterval(interval);
            startDriverSearch();
        }
    }, 2000);
};
```

### **⚙️ BACKEND (APIs):**

```javascript
// 1. API DE CÁLCULO DE CORRIDA
app.post('/calculate-trip', async (req, res) => {
    const { origin, destination } = req.body;
    
    const tripCalculation = await calculateTripValue(origin, destination);
    
    res.json({
        value: tripCalculation.value,
        estimatedTime: tripCalculation.estimatedTime,
        distance: tripCalculation.distance,
        fee: tripCalculation.fee
    });
});

// 2. API DE CRIAÇÃO DE COBRANÇA PIX
app.post('/create-pix-charge', async (req, res) => {
    const { value, correlationID, comment } = req.body;
    
    const pixCharge = await woovi.createCharge({
        value,
        correlationID,
        comment,
        expiresIn: 3600 // 1 hora
    });
    
    // Salvar no banco
    await saveTripData({
        chargeId: pixCharge.charge.identifier,
        correlationID,
        value,
        status: 'PENDING_PAYMENT'
    });
    
    res.json(pixCharge);
});

// 3. WEBHOOK DE CONFIRMAÇÃO DE PAGAMENTO
app.post('/woovi-webhook', async (req, res) => {
    const { event, charge } = req.body;
    
    if (event === 'charge.confirmed') {
        // Atualizar status da corrida
        await updateTripStatus(charge.correlationID, 'PAYMENT_CONFIRMED');
        
        // Iniciar busca de motoristas
        await startDriverSearch(charge.correlationID);
        
        // Notificar cliente
        await notifyClient(charge.correlationID, 'PAYMENT_CONFIRMED');
    }
    
    res.json({ success: true });
});

// 4. API DE CANCELAMENTO
app.post('/cancel-trip', async (req, res) => {
    const { tripId, reason } = req.body;
    
    const trip = await getTripData(tripId);
    const cancellationFee = calculateCancellationFee(trip);
    
    if (cancellationFee.refundAmount > 0) {
        await woovi.createRefund({
            chargeId: trip.chargeId,
            amount: cancellationFee.refundAmount,
            reason: `Cancelamento: ${reason}`
        });
    }
    
    await updateTripStatus(tripId, 'CANCELLED');
    
    res.json({
        success: true,
        refundAmount: cancellationFee.refundAmount,
        fee: cancellationFee.fee
    });
});
```

### **🗄️ BANCO DE DADOS:**

```sql
-- TABELA DE CORRIDAS
CREATE TABLE trips (
    id VARCHAR(36) PRIMARY KEY,
    charge_id VARCHAR(100),
    correlation_id VARCHAR(100),
    client_id VARCHAR(100),
    origin_lat DECIMAL(10,8),
    origin_lng DECIMAL(10,8),
    destination_lat DECIMAL(10,8),
    destination_lng DECIMAL(10,8),
    value INTEGER, -- em centavos
    status ENUM('PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'DRIVER_SEARCH', 'DRIVER_ACCEPTED', 'TRIP_STARTED', 'TRIP_COMPLETED', 'CANCELLED'),
    payment_method ENUM('PIX_ONLY'),
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    cancelled_at TIMESTAMP NULL,
    cancellation_reason VARCHAR(255) NULL,
    refund_amount INTEGER NULL,
    cancellation_fee INTEGER NULL
);

-- TABELA DE TAXAS DE CANCELAMENTO
CREATE TABLE cancellation_fees (
    id INT PRIMARY KEY AUTO_INCREMENT,
    trip_status ENUM('PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'DRIVER_SEARCH', 'DRIVER_ACCEPTED', 'TRIP_STARTED', 'TRIP_COMPLETED'),
    time_elapsed_minutes INT,
    fee_percentage DECIMAL(5,2),
    description VARCHAR(255)
);
```

---

## 📊 **ESTADOS DA CORRIDA**

### **🔄 FLUXO DE ESTADOS:**

```
PENDING_PAYMENT
    ↓ (pagamento confirmado)
PAYMENT_CONFIRMED
    ↓ (inicia busca)
DRIVER_SEARCH
    ↓ (motorista aceita)
DRIVER_ACCEPTED
    ↓ (inicia viagem)
TRIP_STARTED
    ↓ (viagem concluída)
TRIP_COMPLETED
```

### **❌ ESTADOS DE CANCELAMENTO:**

```
CANCELLED_BY_CLIENT
CANCELLED_BY_DRIVER
CANCELLED_BY_SYSTEM
```

---

## 🔐 **SEGURANÇA E VALIDAÇÕES**

### **✅ VALIDAÇÕES OBRIGATÓRIAS:**

1. **Validação de Destino:**
   - Coordenadas válidas
   - Distância máxima permitida
   - Área de cobertura

2. **Validação de Pagamento:**
   - Valor mínimo/máximo
   - Tempo limite de pagamento
   - Verificação de duplicidade

3. **Validação de Cancelamento:**
   - Tempo limite para cancelamento
   - Motivo obrigatório
   - Histórico de cancelamentos

### **🛡️ MEDIDAS DE SEGURANÇA:**

1. **Rate Limiting:**
   - Máximo 5 tentativas de pagamento por hora
   - Máximo 3 cancelamentos por dia

2. **Fraude:**
   - Detecção de pagamentos duplicados
   - Verificação de IP
   - Análise de padrões

3. **Backup:**
   - Logs de todas as transações
   - Backup automático dos dados
   - Recuperação de falhas

---

## 📈 **MÉTRICAS E MONITORAMENTO**

### **📊 KPIs IMPORTANTES:**

1. **Taxa de Conversão:**
   - Pagamentos iniciados → Pagamentos confirmados
   - Meta: > 85%

2. **Taxa de Cancelamento:**
   - Corridas canceladas / Total de corridas
   - Meta: < 15%

3. **Tempo de Pagamento:**
   - Tempo médio para confirmar pagamento
   - Meta: < 2 minutos

4. **Satisfação:**
   - Avaliação média dos clientes
   - Meta: > 4.5/5

### **🔍 MONITORAMENTO EM TEMPO REAL:**

```javascript
// Dashboard de Monitoramento
const monitoringMetrics = {
    activeTrips: await getActiveTrips(),
    pendingPayments: await getPendingPayments(),
    confirmedPayments: await getConfirmedPayments(),
    cancelledTrips: await getCancelledTrips(),
    averagePaymentTime: await getAveragePaymentTime(),
    conversionRate: await getConversionRate()
};
```

---

## 🚀 **PLANO DE IMPLEMENTAÇÃO**

### **📅 FASE 1 (SEMANA 1):**
- [ ] Implementar cálculo de corrida
- [ ] Integrar Woovi PIX
- [ ] Criar tela de pagamento
- [ ] Implementar webhook

### **📅 FASE 2 (SEMANA 2):**
- [ ] Implementar busca de motoristas
- [ ] Criar sistema de cancelamento
- [ ] Implementar devoluções
- [ ] Testes de integração

### **📅 FASE 3 (SEMANA 3):**
- [ ] Implementar monitoramento
- [ ] Criar dashboard
- [ ] Testes de carga
- [ ] Deploy em produção

### **📅 FASE 4 (SEMANA 4):**
- [ ] Otimizações
- [ ] Correções de bugs
- [ ] Documentação
- [ ] Treinamento da equipe

---

## ✅ **CONCLUSÃO**

**Este fluxo garante:**
- ✅ **Pagamento antecipado** via PIX
- ✅ **Sem inadimplência** de clientes
- ✅ **Cancelamento inteligente** com regras claras
- ✅ **Devolução automática** quando necessário
- ✅ **Monitoramento completo** do processo

**Próximo passo:** Implementar a Fase 1! 🚀 