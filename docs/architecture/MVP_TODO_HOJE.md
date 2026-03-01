# 🚀 MVP TODO - FINALIZAR HOJE PARA STORES

## 📅 Data: 15 de Janeiro de 2025
## 🎯 Objetivo: Submeter nas stores ainda hoje

---

## ✅ PRIORIDADE MÁXIMA (Fazer Primeiro)

### 1. 💰 **Sistema de Saldo por ID do Motorista** (Substituir BaaS temporariamente)
- [ ] Criar coleção `driver_balances` no Firestore
- [ ] Estrutura: `{ driverId, balance, pendingBalance, totalEarnings, lastUpdated }`
- [ ] Modificar `processNetDistribution` para creditar saldo ao invés de transferir via BaaS
- [ ] Criar função `creditDriverBalance(driverId, amount)` no payment-service
- [ ] Atualizar `completeTrip` para usar novo sistema de saldo
- [ ] **Arquivo**: `leaf-websocket-backend/services/payment-service.js`

**Código necessário:**
```javascript
// Em payment-service.js
async creditDriverBalance(driverId, netAmount) {
  const firestore = firebaseConfig.getFirestore();
  const balanceRef = firestore.collection('driver_balances').doc(driverId);
  
  await balanceRef.set({
    balance: admin.firestore.FieldValue.increment(netAmount),
    totalEarnings: admin.firestore.FieldValue.increment(netAmount),
    lastUpdated: new Date().toISOString()
  }, { merge: true });
}
```

---

### 2. 💾 **Persistência de Corridas no Firestore**
- [ ] Criar coleção `rides` no Firestore
- [ ] Salvar corrida quando criada (`createBooking`)
- [ ] Atualizar status em cada mudança (accepted, started, completed)
- [ ] Salvar dados finais quando finalizada
- [ ] **Arquivo**: `leaf-websocket-backend/server.js` (evento `createBooking`, `acceptRide`, `startTrip`, `completeTrip`)

**Estrutura:**
```javascript
{
  rideId: string,
  passengerId: string,
  driverId: string,
  status: 'pending' | 'accepted' | 'started' | 'completed' | 'cancelled',
  pickupLocation: { lat, lng, address },
  destinationLocation: { lat, lng, address },
  fare: number,
  netFare: number,
  createdAt: timestamp,
  acceptedAt: timestamp,
  startedAt: timestamp,
  completedAt: timestamp
}
```

---

### 3. 💳 **Persistência de Pagamentos**
- [ ] Criar coleção `payment_holdings` no Firestore
- [ ] Salvar quando pagamento é confirmado (`confirmPaymentAndHold`)
- [ ] Atualizar status quando corrida finaliza ou cancela
- [ ] **Arquivo**: `leaf-websocket-backend/services/payment-service.js`

**Estrutura:**
```javascript
{
  rideId: string,
  chargeId: string,
  passengerId: string,
  amount: number,
  status: 'pending_payment' | 'in_holding' | 'distributed' | 'refunded',
  createdAt: timestamp,
  confirmedAt: timestamp,
  distributedAt: timestamp
}
```

---

### 4. 🔒 **Validação Crítica: Pagamento Antes de Iniciar**
- [ ] Adicionar validação no evento `startTrip` do backend
- [ ] Verificar se pagamento está `in_holding`
- [ ] Bloquear início se não estiver confirmado
- [ ] **Arquivo**: `leaf-websocket-backend/server.js` (linha ~1192)

**Código:**
```javascript
socket.on('startTrip', async (data) => {
  const { bookingId } = data;
  
  // ✅ VALIDAÇÃO CRÍTICA
  const paymentStatus = await paymentService.getPaymentStatus(bookingId);
  if (paymentStatus.status !== 'in_holding') {
    socket.emit('tripStartError', {
      error: 'Pagamento não confirmado',
      message: 'A corrida só pode ser iniciada após confirmação do pagamento'
    });
    return;
  }
  
  // ... resto do código
});
```

---

### 5. 💬 **Persistência de Mensagens do Chat**
- [ ] Criar coleção `chat_messages` no Firestore
- [ ] Salvar mensagens quando enviadas
- [ ] Adicionar TTL de 90 dias
- [ ] **Arquivo**: `leaf-websocket-backend/server.js` (evento de chat)

---

## 🧪 TESTES CRÍTICOS

### 6. ✅ **Testar Fluxo Completo do Motorista**
- [ ] Login como motorista
- [ ] Ficar online
- [ ] Receber notificação de corrida
- [ ] Aceitar corrida
- [ ] Iniciar corrida (validar pagamento)
- [ ] Finalizar corrida
- [ ] Verificar saldo creditado

### 7. ✅ **Testar Fluxo Completo do Passageiro**
- [ ] Buscar corrida
- [ ] Pagar via PIX
- [ ] Aguardar motorista
- [ ] Motorista aceita
- [ ] Corrida inicia
- [ ] Corrida finaliza
- [ ] Verificar dados salvos

---

## 🧹 LIMPEZA E CONFIGURAÇÃO

### 8. 🗑️ **Remover TODOs e Simulações**
- [ ] Buscar todos os `TODO` no código
- [ ] Remover simulações de pagamento
- [ ] Garantir que está usando Woovi real (não mocks)
- [ ] **Comando**: `grep -r "TODO\|FIXME\|simulate\|mock" --include="*.js"`

### 9. 🔑 **Configurar Credenciais de Produção**
- [ ] Verificar variáveis de ambiente Woovi
- [ ] Remover credenciais de sandbox se necessário
- [ ] Configurar webhook de produção
- [ ] Testar com credenciais reais

---

## 📱 BUILD E SUBMISSÃO

### 10. 🔨 **Build Android (Play Store)**
- [ ] Limpar projeto: `cd mobile-app/android && ./gradlew clean`
- [ ] Build release: `./gradlew assembleRelease` ou `bundleRelease`
- [ ] Gerar AAB para Play Store
- [ ] Assinar APK/AAB
- [ ] Testar build em dispositivo

### 11. 🍎 **Build iOS (App Store)**
- [ ] Limpar projeto: `cd mobile-app/ios && xcodebuild clean`
- [ ] Configurar certificados e provisioning profiles
- [ ] Build archive: `xcodebuild archive`
- [ ] Exportar IPA
- [ ] Testar build em dispositivo

### 12. 📸 **Assets para Stores**
- [ ] Ícone do app (1024x1024 para iOS, múltiplos tamanhos para Android)
- [ ] Screenshots (pelo menos 3 por plataforma)
- [ ] Descrição do app
- [ ] Política de privacidade (URL)
- [ ] Termos de uso (URL)
- [ ] Categoria e tags

### 13. 📤 **Submeter Play Store**
- [ ] Criar/atualizar listing
- [ ] Upload AAB
- [ ] Preencher formulário completo
- [ ] Submeter para revisão

### 14. 📤 **Submeter App Store**
- [ ] Criar/atualizar listing no App Store Connect
- [ ] Upload IPA
- [ ] Preencher formulário completo
- [ ] Submeter para revisão

---

## ⚠️ CHECKLIST FINAL ANTES DE SUBMETER

- [ ] Todos os testes passando
- [ ] Sem TODOs críticos no código
- [ ] Credenciais de produção configuradas
- [ ] Persistência funcionando
- [ ] Validações de segurança implementadas
- [ ] Builds testados em dispositivos reais
- [ ] Assets prontos
- [ ] Políticas de privacidade publicadas
- [ ] Termos de uso publicados

---

## 🎯 ORDEM DE EXECUÇÃO SUGERIDA

1. **Sistema de saldo** (1-2h) - Substituir BaaS
2. **Persistência** (2-3h) - Corridas, pagamentos, chat
3. **Validações** (1h) - Pagamento antes de iniciar
4. **Testes** (1-2h) - Fluxos completos
5. **Limpeza** (30min) - Remover TODOs
6. **Builds** (1-2h) - Android e iOS
7. **Assets** (1h) - Preparar para stores
8. **Submissão** (30min) - Enviar para revisão

**Tempo Total Estimado**: 8-12 horas

---

## 📝 NOTAS IMPORTANTES

- **BaaS não é crítico** - Podemos usar saldo vinculado ao ID do motorista
- **Foco em funcionalidade básica** - MVP não precisa de todas as features
- **Testar bem antes de submeter** - Revisões nas stores podem levar dias
- **Documentar tudo** - Facilita correções futuras

---

**Status**: 🟡 Em andamento - Foco total no MVP!


