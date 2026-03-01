# 📊 ANÁLISE COMPLETA: PERSISTÊNCIA DE CORRIDAS

## 📅 Data: 16 de Dezembro de 2025

---

## 🎯 **CONTEXTO E REQUISITOS**

### **Estratégia Definida:**
- **Redis**: Dados em tempo real da corrida (estados, localizações, cache)
- **Firestore**: Apenas começo e fim da corrida (persistência permanente)

### **Pergunta Central:**
> **Redis réplica + salvar começo/fim no Firestore resolveria?**

---

## 📋 **OPÇÕES DE ARQUITETURA**

### **OPÇÃO 1: Redis Standalone + Firestore (Começo/Fim)** ⭐ RECOMENDADA

#### **Arquitetura:**
```
┌─────────────┐
│   Cliente   │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│   Backend   │────▶│ Redis (RTDB) │ ← Dados em tempo real
└──────┬──────┘     └──────────────┘
       │
       │ (Eventos críticos)
       ▼
┌─────────────┐
│  Firestore  │ ← Apenas começo e fim
└─────────────┘
```

#### **Fluxo de Dados:**
1. **Criação da Corrida:**
   - ✅ Salvar no Redis (estado, localizações, cache)
   - ✅ Salvar snapshot inicial no Firestore (`status: 'pending'`, `createdAt`)

2. **Durante a Corrida:**
   - ✅ Apenas Redis (atualizações de localização, mudanças de estado)
   - ❌ Firestore não é atualizado (economia de custos)

3. **Finalização:**
   - ✅ Atualizar Redis (estado final, dados completos)
   - ✅ Salvar snapshot final no Firestore (`status: 'completed'`, `completedAt`, `finalPrice`, etc.)

#### **Vantagens:**
- ✅ **Simplicidade**: Arquitetura simples e direta
- ✅ **Performance**: Redis ultra-rápido para operações em tempo real
- ✅ **Custo**: Firestore cobra por escrita (economia significativa)
- ✅ **Escalabilidade**: Redis escala horizontalmente facilmente
- ✅ **Latência**: Operações em tempo real sem overhead de Firestore

#### **Desvantagens:**
- ⚠️ **Risco de Perda**: Se Redis cair, dados em tempo real são perdidos
- ⚠️ **Sem Backup Automático**: Depende de snapshot no Firestore
- ⚠️ **Recuperação Limitada**: Não é possível recuperar estado intermediário

#### **Custo Estimado (mensal):**
- Redis (VPS próprio): ~R$ 50-100
- Firestore (writes): ~R$ 0.18 por 100k writes
  - 10k corridas/dia × 2 writes (começo + fim) = 20k writes/dia
  - 600k writes/mês = ~R$ 1.08/mês
- **Total: ~R$ 51-101/mês**

#### **Confiabilidade:**
- **Disponibilidade**: 99.5% (depende do VPS)
- **RPO (Recovery Point Objective)**: ~5 minutos (se Redis cair)
- **RTO (Recovery Time Objective)**: ~10 minutos (restart Redis)

---

### **OPÇÃO 2: Redis Replica (Master-Slave) + Firestore (Começo/Fim)**

#### **Arquitetura:**
```
┌─────────────┐
│   Cliente   │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Backend   │────▶│ Redis Master │────▶│ Redis Slave  │
└──────┬──────┘     └──────────────┘     └──────────────┘
       │                    │
       │                    │ (Replicação automática)
       │                    │
       │ (Eventos críticos)  │
       ▼                    ▼
┌─────────────┐     ┌──────────────┐
│  Firestore  │     │  Backup RDB   │
└─────────────┘     └──────────────┘
```

#### **Fluxo de Dados:**
1. **Criação da Corrida:**
   - ✅ Salvar no Redis Master
   - ✅ Replicação automática para Redis Slave
   - ✅ Salvar snapshot inicial no Firestore

2. **Durante a Corrida:**
   - ✅ Apenas Redis (Master → Slave automático)
   - ❌ Firestore não é atualizado

3. **Finalização:**
   - ✅ Atualizar Redis Master (replica para Slave)
   - ✅ Salvar snapshot final no Firestore

#### **Vantagens:**
- ✅ **Alta Disponibilidade**: Se Master cair, Slave assume (com Sentinel)
- ✅ **Backup Automático**: Replicação em tempo real
- ✅ **Recuperação Rápida**: Failover automático
- ✅ **Durabilidade**: Dados replicados em 2 instâncias
- ✅ **Mesma Performance**: Redis continua ultra-rápido

#### **Desvantagens:**
- ⚠️ **Complexidade**: Configuração mais complexa (Sentinel, failover)
- ⚠️ **Custo**: 2x instâncias Redis (ou Redis Cloud com replica)
- ⚠️ **Manutenção**: Mais componentes para gerenciar
- ⚠️ **Latência de Replicação**: ~1-5ms de delay (geralmente aceitável)

#### **Custo Estimado (mensal):**
- Redis Master (VPS): ~R$ 50-100
- Redis Slave (VPS): ~R$ 50-100
- **OU** Redis Cloud (com replica): ~R$ 150-300/mês
- Firestore: ~R$ 1.08/mês
- **Total: ~R$ 101-201/mês (VPS) ou ~R$ 151-301/mês (Cloud)**

#### **Confiabilidade:**
- **Disponibilidade**: 99.9% (com failover automático)
- **RPO**: ~1-5ms (dados replicados quase instantaneamente)
- **RTO**: ~30 segundos (failover automático)

---

### **OPÇÃO 3: Redis Cluster + Firestore (Começo/Fim)**

#### **Arquitetura:**
```
┌─────────────┐
│   Cliente   │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────────────────┐
│   Backend   │────▶│  Redis Cluster (3+ nodes)│
└──────┬──────┘     └─────────────────────────┘
       │                    │
       │                    │ (Sharding + Replicação)
       │                    │
       │ (Eventos críticos)  │
       ▼                    ▼
┌─────────────┐     ┌──────────────┐
│  Firestore  │     │  Persistência │
└─────────────┘     └──────────────┘
```

#### **Vantagens:**
- ✅ **Alta Escalabilidade**: Suporta milhões de operações/segundo
- ✅ **Alta Disponibilidade**: Múltiplos nós, failover automático
- ✅ **Distribuição**: Dados distribuídos entre nós
- ✅ **Performance**: Mantém latência ultra-baixa

#### **Desvantagens:**
- ❌ **Complexidade Alta**: Configuração e manutenção complexas
- ❌ **Custo Alto**: 3+ instâncias Redis
- ❌ **Overkill**: Desnecessário para MVP/startup
- ❌ **Curva de Aprendizado**: Requer conhecimento avançado

#### **Custo Estimado (mensal):**
- Redis Cluster (3 nodes mínimo): ~R$ 150-300/mês
- Firestore: ~R$ 1.08/mês
- **Total: ~R$ 151-301/mês**

#### **Confiabilidade:**
- **Disponibilidade**: 99.99% (alta redundância)
- **RPO**: ~1-5ms
- **RTO**: ~10-30 segundos

---

### **OPÇÃO 4: Redis + Firestore (Todos os Estados)** ❌ NÃO RECOMENDADA

#### **Arquitetura:**
```
┌─────────────┐
│   Cliente   │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│   Backend   │────▶│ Redis (RTDB) │
└──────┬──────┘     └──────────────┘
       │
       │ (TODOS os eventos)
       ▼
┌─────────────┐
│  Firestore  │ ← Todos os estados (pending, accepted, started, etc.)
└─────────────┘
```

#### **Desvantagens:**
- ❌ **Custo Alto**: Firestore cobra por escrita (muitas writes)
- ❌ **Latência**: Overhead de escrita no Firestore a cada mudança
- ❌ **Desnecessário**: Dados intermediários não são críticos
- ❌ **Performance**: Impacto na velocidade de operações em tempo real

#### **Custo Estimado (mensal):**
- Redis: ~R$ 50-100
- Firestore: ~R$ 10-50/mês (depende do volume)
- **Total: ~R$ 60-150/mês**

---

### **OPÇÃO 5: Apenas Firestore (Sem Redis)** ❌ NÃO RECOMENDADA

#### **Desvantagens:**
- ❌ **Latência Alta**: Firestore não é otimizado para tempo real
- ❌ **Custo Proibitivo**: Muitas writes = custo alto
- ❌ **Limites de Rate**: Firestore tem limites de writes/segundo
- ❌ **Performance**: Não atende requisitos de tempo real

---

## 🎯 **ANÁLISE COMPARATIVA**

| Critério | Opção 1<br/>Redis Standalone | Opção 2<br/>Redis Replica | Opção 3<br/>Redis Cluster | Opção 4<br/>Todos Estados |
|----------|------------------------------|---------------------------|---------------------------|--------------------------|
| **Simplicidade** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **Performance** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Confiabilidade** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Custo** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| **Escalabilidade** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Manutenção** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **Recuperação** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## 💡 **RECOMENDAÇÃO FINAL**

### **Para MVP / Startup (Até 10k corridas/dia):**
**✅ OPÇÃO 1: Redis Standalone + Firestore (Começo/Fim)**

**Justificativa:**
- ✅ Simplicidade máxima
- ✅ Custo baixo
- ✅ Performance excelente
- ✅ Fácil manutenção
- ✅ Escalável até certo ponto

**Implementação:**
```javascript
// 1. Criar corrida
await redis.hset(`booking:${bookingId}`, bookingData);
await firestore.collection('rides').doc(bookingId).set({
  rideId: bookingId,
  status: 'pending',
  createdAt: new Date(),
  // ... dados iniciais
});

// 2. Durante corrida (apenas Redis)
await redis.hset(`booking:${bookingId}`, {
  status: 'in_progress',
  driverLocation: JSON.stringify(location)
});

// 3. Finalizar corrida
await redis.hset(`booking:${bookingId}`, {
  status: 'completed',
  completedAt: Date.now(),
  finalPrice: finalPrice
});
await firestore.collection('rides').doc(bookingId).update({
  status: 'completed',
  completedAt: new Date(),
  finalPrice: finalPrice,
  // ... dados finais
});
```

---

### **Para Escala (10k+ corridas/dia):**
**✅ OPÇÃO 2: Redis Replica + Firestore (Começo/Fim)**

**Justificativa:**
- ✅ Alta disponibilidade
- ✅ Backup automático
- ✅ Failover automático
- ✅ Custo ainda razoável
- ✅ Performance mantida

**Implementação:**
- Configurar Redis Master-Slave com Sentinel
- Failover automático em caso de queda do Master
- Mesma lógica de persistência (começo/fim no Firestore)

---

## 🔧 **IMPLEMENTAÇÃO RECOMENDADA (OPÇÃO 1)**

### **Estrutura de Dados:**

#### **Redis (Tempo Real):**
```javascript
// Chave: booking:{bookingId}
{
  bookingId: "booking_123",
  customerId: "customer_456",
  driverId: "driver_789",
  status: "in_progress", // pending, accepted, in_progress, completed, cancelled
  pickupLocation: JSON.stringify({ lat: -22.9068, lng: -43.1234 }),
  destinationLocation: JSON.stringify({ lat: -22.9, lng: -43.13 }),
  estimatedFare: "25.50",
  finalPrice: "28.00",
  driverLocation: JSON.stringify({ lat: -22.905, lng: -43.122, timestamp: 1234567890 }),
  createdAt: "2025-12-16T10:00:00.000Z",
  acceptedAt: "2025-12-16T10:02:00.000Z",
  startedAt: "2025-12-16T10:05:00.000Z",
  completedAt: "2025-12-16T10:35:00.000Z"
}
```

#### **Firestore (Persistência Permanente):**
```javascript
// Coleção: rides
{
  rideId: "booking_123",
  passengerId: "customer_456",
  driverId: "driver_789",
  status: "completed", // apenas estados finais
  pickupLocation: { lat: -22.9068, lng: -43.1234, address: "Rua A, 123" },
  destinationLocation: { lat: -22.9, lng: -43.13, address: "Rua B, 456" },
  estimatedFare: 25.50,
  finalPrice: 28.00,
  distance: 12.5, // km
  duration: 30, // minutos
  paymentMethod: "pix",
  paymentStatus: "completed",
  createdAt: Timestamp,
  acceptedAt: Timestamp,
  startedAt: Timestamp,
  completedAt: Timestamp
}
```

### **Serviço de Persistência:**

```javascript
// services/ride-persistence-service.js
class RidePersistenceService {
  async saveRideStart(rideData) {
    // Salvar no Redis (tempo real)
    await redis.hset(`booking:${rideData.rideId}`, {
      ...rideData,
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    
    // Salvar snapshot inicial no Firestore
    await firestore.collection('rides').doc(rideData.rideId).set({
      rideId: rideData.rideId,
      passengerId: rideData.passengerId,
      status: 'pending',
      pickupLocation: rideData.pickupLocation,
      destinationLocation: rideData.destinationLocation,
      estimatedFare: rideData.estimatedFare,
      paymentMethod: rideData.paymentMethod,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  
  async saveRideEnd(rideId, finalData) {
    // Atualizar Redis
    await redis.hset(`booking:${rideId}`, {
      status: 'completed',
      ...finalData,
      completedAt: new Date().toISOString()
    });
    
    // Salvar snapshot final no Firestore
    await firestore.collection('rides').doc(rideId).update({
      status: 'completed',
      driverId: finalData.driverId,
      finalPrice: finalData.finalPrice,
      distance: finalData.distance,
      duration: finalData.duration,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}
```

---

## ⚠️ **RISCOS E MITIGAÇÕES**

### **Risco 1: Perda de Dados se Redis Cair**

**Probabilidade:** Média  
**Impacto:** Alto

**Mitigações:**
1. ✅ **Snapshot no Firestore**: Começo e fim salvos
2. ✅ **Redis Persistence**: Configurar RDB ou AOF
3. ✅ **Backup Manual**: Script de backup periódico
4. ✅ **Monitoramento**: Alertas se Redis cair

**Plano de Recuperação:**
- Se Redis cair durante corrida: Recuperar do Firestore (último estado conhecido)
- Se Redis cair após finalização: Dados já estão no Firestore

---

### **Risco 2: Falha ao Salvar no Firestore**

**Probabilidade:** Baixa  
**Impacto:** Médio

**Mitigações:**
1. ✅ **Retry Logic**: Tentar novamente se falhar
2. ✅ **Queue de Fallback**: Salvar em fila se Firestore indisponível
3. ✅ **Logs**: Registrar todas as tentativas
4. ✅ **Monitoramento**: Alertas se persistência falhar

---

### **Risco 3: Dados Inconsistentes entre Redis e Firestore**

**Probabilidade:** Baixa  
**Impacto:** Médio

**Mitigações:**
1. ✅ **Transações**: Usar transações quando possível
2. ✅ **Idempotência**: Operações devem ser idempotentes
3. ✅ **Validação**: Verificar consistência periodicamente
4. ✅ **Sincronização**: Script de sincronização manual se necessário

---

## 📊 **MÉTRICAS DE SUCESSO**

### **Performance:**
- ✅ Latência de escrita no Redis: < 5ms
- ✅ Latência de escrita no Firestore: < 100ms
- ✅ Taxa de sucesso de persistência: > 99.9%

### **Confiabilidade:**
- ✅ Uptime do Redis: > 99.5%
- ✅ Taxa de recuperação de dados: 100% (começo/fim)

### **Custo:**
- ✅ Custo mensal de infraestrutura: < R$ 150/mês
- ✅ Custo por corrida: < R$ 0.01

---

## 🚀 **PRÓXIMOS PASSOS**

1. ✅ **Implementar OPÇÃO 1** (Redis Standalone + Firestore)
2. ✅ **Criar serviço de persistência** (`ride-persistence-service.js`)
3. ✅ **Adicionar retry logic** para Firestore
4. ✅ **Configurar Redis persistence** (RDB ou AOF)
5. ✅ **Implementar monitoramento** e alertas
6. ✅ **Criar script de backup** periódico
7. ✅ **Testar recuperação** de dados

---

## 📝 **CONCLUSÃO**

**Resposta à pergunta:**
> **Redis réplica + salvar começo/fim no Firestore resolveria?**

**Sim, mas não é necessário para MVP.**

**Recomendação:**
- **MVP**: Redis Standalone + Firestore (começo/fim) ✅
- **Escala**: Redis Replica + Firestore (começo/fim) ✅

**A OPÇÃO 1 (Redis Standalone) é suficiente e resolve o problema de persistência de forma simples, eficiente e econômica.**

---

**Última atualização:** 16/12/2025



