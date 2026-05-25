# ✅ Implementação de Bloqueio/Liberação Automática de Motorista (KYC)

**Data:** 2026-01-08  
**Status:** ✅ Implementado

---

## 📊 O Que Foi Implementado

### 1. **KYCDriverStatusService** (`services/kyc-driver-status-service.js`)

Serviço completo para gerenciar bloqueio/liberação de motoristas baseado em KYC:

- ✅ **blockDriver()** - Bloqueia motorista quando KYC falha
- ✅ **unblockDriver()** - Libera motorista quando KYC é aprovado
- ✅ **isDriverBlocked()** - Verifica se motorista está bloqueado
- ✅ **canDriverWork()** - Verifica se motorista pode fazer corridas
- ✅ **processOnboardingResult()** - Processa resultado do onboarding
- ✅ **processVerificationResult()** - Processa resultado da verificação

**Features:**
- Atualiza Redis e Firestore
- Força motorista offline quando bloqueado
- Envia notificações push
- Validação em múltiplas camadas

---

### 2. **Integração com Onboarding KYC** (`routes/kyc-onboarding.js`)

**Onboarding (CNH + Selfie):**
```javascript
// Após processar KYC
const result = await kycService.processOnboarding(...);

// ✅ Processar bloqueio/liberação
await kycDriverStatusService.processOnboardingResult(driverId, result);
```

**Re-verificação:**
```javascript
// Após re-verificar
const result = await kycService.reverifyIdentity(...);

// ✅ Processar bloqueio/liberação
await kycDriverStatusService.processVerificationResult(driverId, result);
```

---

### 3. **Integração com Verificação KYC** (`services/IntegratedKYCService.js`)

**Verificação em tempo real:**
```javascript
// Após verificar driver
if (retryResult.success) {
  // ✅ Processar bloqueio/liberação
  await kycDriverStatusService.processVerificationResult(userId, {
    success: retryResult.result.isMatch,
    isMatch: retryResult.result.isMatch,
    similarityScore: retryResult.result.similarityScore,
    confidence: retryResult.result.confidence
  });
}
```

---

### 4. **Validação em DriverPoolMonitor** (`services/driver-pool-monitor.js`)

**Verificação antes de disponibilizar motorista:**
```javascript
async isDriverAvailable(driverId) {
  // ✅ 0. Verificar se motorista está bloqueado por KYC (PRIORIDADE)
  const canWork = await kycDriverStatusService.canDriverWork(driverId);
  if (!canWork) {
    return false; // Motorista bloqueado
  }
  
  // ... outras verificações
}
```

---

### 5. **Validação no WebSocket** (`server.js`)

**Bloqueio ao tentar ficar online:**
```javascript
socket.on('setDriverStatus', async (data) => {
  // ✅ Verificar se motorista está bloqueado por KYC
  const canWork = await kycDriverStatusService.canDriverWork(driverId);
  if (!canWork) {
    socket.emit('driverStatusError', { 
      error: 'Sua conta está bloqueada. Entre em contato com o suporte.',
      blocked: true
    });
    return;
  }
  
  // ... continuar com lógica normal
});
```

---

## 🔄 Fluxo Completo

### Onboarding (Primeira Vez):

```
1. Motorista faz upload de CNH + Selfie
   └─> kycService.processOnboarding()

2. Compara CNH ↔ Selfie
   └─> Calcula similaridade

3. Se aprovado (similarity >= 0.65):
   └─> Salva foto âncora
   └─> kycDriverStatusService.unblockDriver()
   └─> Atualiza Redis: kycStatus = 'approved', kycBlocked = false
   └─> Atualiza Firestore: kycStatus = 'approved', kycBlocked = false
   └─> Envia notificação: "Conta aprovada!"

4. Se rejeitado (similarity < 0.65):
   └─> kycDriverStatusService.blockDriver()
   └─> Atualiza Redis: kycStatus = 'blocked', kycBlocked = true
   └─> Atualiza Firestore: kycStatus = 'blocked', kycBlocked = true
   └─> Força motorista offline
   └─> Envia notificação: "Conta bloqueada"
```

### Verificação (Re-verificação):

```
1. Motorista tira nova selfie
   └─> kycService.reverifyIdentity() ou IntegratedKYCService.verifyDriver()

2. Compara Selfie Atual ↔ Foto de Perfil
   └─> Calcula similaridade

3. Se match (similarity >= threshold):
   └─> kycDriverStatusService.processVerificationResult()
   └─> Mantém liberado (atualiza última verificação)
   └─> Envia notificação: "Verificação aprovada"

4. Se não match (similarity < threshold):
   └─> kycDriverStatusService.blockDriver()
   └─> Atualiza Redis: kycStatus = 'blocked', kycBlocked = true
   └─> Atualiza Firestore: kycStatus = 'blocked', kycBlocked = true
   └─> Força motorista offline
   └─> Envia notificação: "Conta bloqueada"
```

### Tentativa de Ficar Online:

```
1. Motorista tenta ficar online
   └─> socket.on('setDriverStatus')

2. Verifica se está bloqueado
   └─> kycDriverStatusService.canDriverWork()
   └─> Se bloqueado: retorna erro
   └─> Se liberado: continua normalmente

3. Motorista bloqueado não pode:
   └─> Ficar online
   └─> Receber corridas
   └─> Aceitar corridas
```

---

## 📦 Estrutura de Dados

### Redis (`driver:{driverId}`):

```javascript
{
  kyc_status: 'approved' | 'blocked' | 'pending' | 'rejected',
  kyc_blocked: 'true' | 'false',
  kyc_blocked_at: '2026-01-08T10:30:00.000Z',
  kyc_blocked_reason: 'KYC não aprovado',
  kyc_approved_at: '2026-01-08T10:30:00.000Z',
  kyc_last_verification: '2026-01-08T10:30:00.000Z',
  isOnline: 'false', // Forçado quando bloqueado
  status: 'OFFLINE' // Forçado quando bloqueado
}
```

### Firestore (`drivers/{driverId}` e `users/{driverId}`):

```javascript
{
  kycStatus: 'approved' | 'blocked' | 'pending' | 'rejected',
  kycBlocked: true | false,
  kycBlockedAt: Timestamp,
  kycBlockedReason: 'KYC não aprovado',
  kycApprovedAt: Timestamp,
  kycLastVerification: Timestamp,
  similarityScore: 0.85,
  confidence: 0.85
}
```

---

## 🔔 Notificações

### Quando Bloqueado:

```
Título: 🚫 Conta Bloqueada
Corpo: Sua conta foi bloqueada: {reason}. Entre em contato com o suporte para mais informações.
Tipo: kyc_blocked
```

### Quando Liberado:

```
Título: ✅ Verificação Aprovada
Corpo: Sua identidade foi verificada com sucesso! Você pode ficar online agora.
Tipo: kyc_verification_success
```

---

## ✅ Validações Implementadas

### 1. **DriverPoolMonitor** (`isDriverAvailable`)
- ✅ Verifica bloqueio KYC antes de disponibilizar motorista
- ✅ Motorista bloqueado não recebe corridas

### 2. **WebSocket** (`setDriverStatus`)
- ✅ Verifica bloqueio KYC antes de permitir ficar online
- ✅ Retorna erro se bloqueado

### 3. **Onboarding KYC** (`/api/drivers/kyc/onboarding`)
- ✅ Bloqueia automaticamente se rejeitado
- ✅ Libera automaticamente se aprovado

### 4. **Verificação KYC** (`/api/drivers/kyc/verify` e `IntegratedKYCService`)
- ✅ Bloqueia automaticamente se verificação falhar
- ✅ Mantém liberado se verificação passar

---

## 🧪 Como Testar

### 1. Testar Bloqueio no Onboarding:

```bash
# Fazer upload de CNH e Selfie diferentes
POST /api/drivers/kyc/onboarding
{
  "driverId": "test-driver-123",
  "cnh": <file>,
  "selfie": <file>
}

# Resultado esperado:
{
  "success": true,
  "data": {
    "approved": false,
    "blocked": true,
    "message": "KYC rejeitado. As imagens não correspondem. Sua conta foi bloqueada."
  }
}
```

### 2. Testar Liberação no Onboarding:

```bash
# Fazer upload de CNH e Selfie da mesma pessoa
POST /api/drivers/kyc/onboarding
{
  "driverId": "test-driver-123",
  "cnh": <file>,
  "selfie": <file>
}

# Resultado esperado:
{
  "success": true,
  "data": {
    "approved": true,
    "blocked": false,
    "message": "KYC aprovado com sucesso! Sua conta foi liberada."
  }
}
```

### 3. Testar Bloqueio na Verificação:

```bash
# Verificar com selfie diferente
POST /api/drivers/kyc/verify
{
  "driverId": "test-driver-123",
  "selfie": <file>
}

# Resultado esperado:
{
  "success": true,
  "data": {
    "approved": false,
    "blocked": true,
    "message": "Re-verificação falhou. As imagens não correspondem. Sua conta foi bloqueada."
  }
}
```

### 4. Testar Tentativa de Ficar Online Bloqueado:

```javascript
// WebSocket
socket.emit('setDriverStatus', { isOnline: true });

// Resultado esperado:
socket.on('driverStatusError', (error) => {
  console.log(error.error); // "Sua conta está bloqueada. Entre em contato com o suporte."
  console.log(error.blocked); // true
});
```

---

## 📝 Notas Importantes

### Fail-Open Strategy:

- Se verificação de bloqueio falhar, sistema assume que motorista **não está bloqueado**
- Isso evita bloquear motoristas legítimos por erros técnicos
- Logs são registrados para investigação

### Múltiplas Fontes de Verdade:

- Redis (rápido) - usado para verificações frequentes
- Firestore (persistente) - usado como fonte de verdade
- Ambos são atualizados simultaneamente

### Notificações:

- Notificações são enviadas via FCM
- Se FCM falhar, não bloqueia o processo
- Logs são registrados para investigação

---

## ✅ Checklist

- [x] KYCDriverStatusService criado
- [x] Integração com onboarding KYC
- [x] Integração com verificação KYC
- [x] Validação em DriverPoolMonitor
- [x] Validação no WebSocket
- [x] Atualização Redis e Firestore
- [x] Notificações push
- [x] Forçar motorista offline quando bloqueado
- [x] Fail-open strategy
- [x] Logs estruturados

---

## 🚀 Próximos Passos (Opcional)

1. ⏳ Dashboard admin para desbloquear motoristas manualmente
2. ⏳ Histórico de bloqueios/liberações
3. ⏳ Métricas de bloqueios por motivo
4. ⏳ Webhook para notificar sistemas externos

---

**Última atualização:** 2026-01-08

