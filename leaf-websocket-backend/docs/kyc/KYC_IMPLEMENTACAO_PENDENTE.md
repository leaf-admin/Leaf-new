# 🔧 KYC - O QUE FALTA IMPLEMENTAR

## ✅ O QUE JÁ ESTÁ PRONTO

1. **Rotas de API** ✅
   - `POST /api/kyc/upload-profile` - Upload foto CNH
   - `POST /api/kyc/verify-driver` - Verificar face (câmera vs CNH)
   - `GET /api/kyc/encoding/:userId` - Obter encoding
   - `DELETE /api/kyc/encoding/:userId` - Deletar encoding

2. **Serviços** ✅
   - `IntegratedKYCService` - Serviço principal
   - `KYCFaceWorker` - Workers para processamento
   - `KYCRetryService` - Retry automático
   - `KYCAnalyticsService` - Analytics
   - `KYCNotificationService` - Notificações

3. **Validações** ✅
   - Validação de UUID
   - Health check
   - Stats e analytics

## ❌ O QUE FALTA IMPLEMENTAR

### **1. Liveness Detection (Verificação de Ação)**
**Status:** ❌ Não implementado

**O que fazer:**
- Adicionar endpoint: `POST /api/kyc/liveness-check`
- Solicitar ação: "Sorria", "Piscar olhos", "Virar cabeça"
- Verificar se ação foi executada na câmera
- Retornar sucesso/falha

**Implementação sugerida:**
```javascript
// Em kyc-routes.js
router.post('/liveness-check', upload.single('actionImage'), async (req, res) => {
  const { userId, action } = req.body; // 'smile', 'blink', 'turn_head'
  const imageBuffer = req.file.buffer;
  
  // Verificar se ação foi executada
  const result = await kycService.checkLiveness(userId, action, imageBuffer);
  
  if (result.success) {
    // Ação detectada corretamente
    res.json({ success: true, actionDetected: true });
  } else {
    res.json({ success: false, error: 'Ação não detectada' });
  }
});
```

### **2. Integração com Status do Motorista**
**Status:** ⚠️ Parcialmente implementado

**O que fazer:**
- Após KYC bem-sucedido, **liberar** motorista para ficar online
- Após KYC falhar, **bloquear** motorista (não pode ficar online)
- Adicionar flag `kycVerified` no Redis/Firebase
- Verificar `kycVerified` antes de permitir `setDriverStatus('online')`

**Implementação sugerida:**
```javascript
// Em server.js, no handler setDriverStatus
socket.on('setDriverStatus', async (data) => {
  const driverId = socket.userId;
  const { status } = data;
  
  // Se tentando ficar online, verificar KYC
  if (status === 'online' || status === 'available') {
    const kycStatus = await redis.hget(`driver:${driverId}`, 'kycVerified');
    
    if (kycStatus !== 'true') {
      socket.emit('driverStatusError', { 
        error: 'KYC não verificado. Complete a verificação facial primeiro.',
        requiresKYC: true
      });
      return;
    }
  }
  
  // Continuar com atualização de status...
});
```

### **3. Fluxo Completo no App Mobile**
**Status:** ❌ Não implementado

**O que fazer:**
- Tela de upload de CNH
- Tela de verificação facial (câmera)
- Tela de liveness (ação solicitada)
- Feedback visual (sucesso/falha)
- Bloqueio de botão "Ficar Online" se KYC não verificado

### **4. Armazenamento de Status KYC**
**Status:** ⚠️ Parcialmente implementado

**O que fazer:**
- Salvar `kycVerified: true/false` no Redis (`driver:${driverId}`)
- Salvar `kycVerifiedAt: timestamp` 
- Salvar `kycLastAttempt: timestamp`
- Salvar `kycAttempts: number`

---

## 🎯 FLUXO COMPLETO ESPERADO

```
1. Motorista faz upload da CNH
   ↓
2. Sistema extrai foto da CNH e salva encoding
   ↓
3. Motorista tira foto com câmera
   ↓
4. Sistema compara foto câmera vs CNH
   ↓
   ├─ Se similaridade >= 85%: ✅ Passa
   └─ Se similaridade < 85%: ❌ Bloqueia
   ↓
5. Sistema solicita ação (ex: "Sorria")
   ↓
6. Motorista executa ação na câmera
   ↓
7. Sistema verifica se ação foi executada
   ↓
   ├─ Se ação detectada: ✅ Motorista fica ONLINE
   └─ Se ação não detectada: ❌ Motorista NÃO fica online
```

---

## 📝 CHECKLIST DE IMPLEMENTAÇÃO

- [ ] **Liveness Detection**
  - [ ] Endpoint `/api/kyc/liveness-check`
  - [ ] Detecção de sorriso
  - [ ] Detecção de piscar olhos
  - [ ] Detecção de virar cabeça

- [ ] **Integração com Status**
  - [ ] Verificar KYC antes de permitir online
  - [ ] Salvar `kycVerified` no Redis
  - [ ] Bloquear motorista se KYC falhar

- [ ] **Fluxo no App**
  - [ ] Tela de upload CNH
  - [ ] Tela de verificação facial
  - [ ] Tela de liveness
  - [ ] Feedback visual

- [ ] **Melhorias**
  - [ ] Retry automático em caso de falha
  - [ ] Notificações push
  - [ ] Analytics detalhados




