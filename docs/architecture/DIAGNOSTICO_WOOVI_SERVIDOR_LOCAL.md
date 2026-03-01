# 🔍 DIAGNÓSTICO: Woovi no Servidor Local

## 📅 Data: 2025-12-19
## 🎯 Objetivo: Avaliar configuração do Woovi para servidor local

---

## ✅ **O QUE ESTÁ FUNCIONANDO**

### **1. Estrutura de Serviços**
- ✅ `WooviService` (mobile-app) - Usa `getApiUrl()` que já aponta para servidor local
- ✅ `WooviDriverService` (backend) - Configurado com variáveis de ambiente
- ✅ Rotas de webhook implementadas
- ✅ Rotas de pagamento implementadas

### **2. Configuração do Mobile App**
- ✅ `WooviService.js` usa `getApiUrl('', false)` - **JÁ APONTA PARA SERVIDOR LOCAL**
- ✅ `ApiConfig.js` já configurado para `192.168.0.37:3001` (servidor local)
- ✅ `WooviConfig.js` tem `webhookUrl: 'http://localhost:3001/api/woovi/webhooks'` - **CORRETO**

---

## ⚠️ **O QUE PRECISA SER AJUSTADO**

### **1. Webhook URL no Backend (CRÍTICO)**

**Arquivo:** `leaf-websocket-backend/config/woovi-sandbox.js`

**Problema:**
```javascript
webhookUrl: 'https://216.238.107.59:3001/api/woovi/webhooks',  // ❌ VPS
```

**Solução:**
```javascript
webhookUrl: 'http://192.168.0.37:3001/api/woovi/webhooks',  // ✅ Servidor local
// OU usar variável de ambiente
webhookUrl: process.env.WOOVI_WEBHOOK_URL || 'http://192.168.0.37:3001/api/woovi/webhooks',
```

**Impacto:**
- ⚠️ Webhooks da Woovi não chegarão ao servidor local
- ⚠️ Pagamentos não serão confirmados automaticamente
- ⚠️ Status de pagamento não será atualizado

---

### **2. Configuração de Webhook na Woovi (CRÍTICO)**

**Problema:**
- Webhooks da Woovi estão configurados para `https://216.238.107.59:3001/api/woovi/webhooks`
- Servidor local não é acessível publicamente (192.168.0.37 é IP privado)

**Soluções Possíveis:**

#### **Opção 1: Usar ngrok (Recomendado para testes)**
```bash
# Instalar ngrok
npm install -g ngrok

# Expor servidor local
ngrok http 3001

# Usar URL do ngrok na configuração da Woovi
# Exemplo: https://abc123.ngrok.io/api/woovi/webhooks
```

#### **Opção 2: Usar servidor VPS como proxy (Temporário)**
- Manter webhook apontando para VPS
- VPS redireciona para servidor local (se necessário)

#### **Opção 3: Testar sem webhook (Manual)**
- Webhooks não funcionarão
- Verificar status manualmente via API

---

### **3. Variáveis de Ambiente (OPCIONAL)**

**Arquivo:** `.env` ou variáveis de ambiente do servidor

**Recomendado adicionar:**
```bash
# Woovi Configuration
WOOVI_API_TOKEN=Q2xpZW50X0lkXzE4YzBkYzI3LTYzMDYtNDFkYy1hMmRlLWI2MzAzMzQ3YzNhZTpDbGllbnRfU2VjcmV0X01ENWpTTW1DMExBYWx2WHhiY0tTSnlrVmYyM0g1Z0FxS0pZaE5zT0tUK1E9
WOOVI_BASE_URL=https://api.woovi-sandbox.com/api/v1
WOOVI_APP_ID=Client_Id_18c0dc27-6306-41dc-a2de-b6303347c3ae
WOOVI_ENVIRONMENT=sandbox
WOOVI_WEBHOOK_URL=http://192.168.0.37:3001/api/woovi/webhooks

# Para produção (quando necessário)
# WOOVI_MASTER_API_TOKEN=...
# WOOVI_MASTER_APP_ID=...
# LEAF_PIX_KEY=...
```

---

## 📋 **CHECKLIST DE VERIFICAÇÃO**

### **Backend (leaf-websocket-backend)**

- [ ] **webhookUrl** em `config/woovi-sandbox.js` aponta para servidor local
- [ ] Servidor rodando em `192.168.0.37:3001` (ou IP correto)
- [ ] Rota `/api/woovi/webhooks` está registrada e funcionando
- [ ] Variáveis de ambiente configuradas (se usar)

### **Mobile App**

- [x] ✅ `WooviService.js` usa `getApiUrl()` - **JÁ CORRETO**
- [x] ✅ `ApiConfig.js` aponta para `192.168.0.37:3001` - **JÁ CORRETO**
- [x] ✅ `WooviConfig.js` tem webhookUrl local - **JÁ CORRETO**

### **Woovi Dashboard (Sandbox)**

- [ ] Webhook URL configurada para servidor local (via ngrok ou IP público)
- [ ] Eventos de webhook habilitados:
  - `Leaf-charge.created`
  - `Leaf-charge.confirmed`
  - `Leaf-charge.expired`
  - `Leaf-charge.received`
  - `Leaf-refund.received`

---

## 🔧 **AÇÕES NECESSÁRIAS**

### **1. Ajustar webhookUrl no Backend (URGENTE)**

**Arquivo:** `leaf-websocket-backend/config/woovi-sandbox.js`

**Mudança:**
```javascript
// ANTES
webhookUrl: 'https://216.238.107.59:3001/api/woovi/webhooks',

// DEPOIS
webhookUrl: process.env.WOOVI_WEBHOOK_URL || 'http://192.168.0.37:3001/api/woovi/webhooks',
```

### **2. Configurar Webhook na Woovi**

**Opção A: Usar ngrok (Recomendado)**
1. Instalar ngrok: `npm install -g ngrok`
2. Executar: `ngrok http 3001`
3. Copiar URL HTTPS (ex: `https://abc123.ngrok.io`)
4. Configurar na Woovi: `https://abc123.ngrok.io/api/woovi/webhooks`

**Opção B: Testar sem webhook (Temporário)**
- Webhooks não funcionarão
- Verificar status manualmente

### **3. Verificar Rotas de Webhook**

**Arquivo:** `leaf-websocket-backend/routes/wooviWebhook.js`

**Verificar:**
- ✅ Rota `/api/woovi/webhooks` está registrada
- ✅ Handler está processando eventos corretamente
- ✅ Responde 200 OK rapidamente

---

## 🧪 **TESTES RECOMENDADOS**

### **1. Testar Criação de Cobrança**
```bash
# Via API
curl -X POST http://192.168.0.37:3001/api/payment/advance \
  -H "Content-Type: application/json" \
  -d '{
    "passengerId": "test_user",
    "amount": 5000,
    "rideId": "test_ride_123"
  }'
```

### **2. Testar Webhook (se ngrok configurado)**
```bash
# Simular webhook da Woovi
curl -X POST https://abc123.ngrok.io/api/woovi/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "event": "Leaf-charge.confirmed",
    "charge": {
      "id": "test_charge_123",
      "status": "CONFIRMED"
    }
  }'
```

### **3. Verificar Status de Pagamento**
```bash
# Via API
curl http://192.168.0.37:3001/api/payment/status/{chargeId}
```

---

## 📊 **RESUMO DO DIAGNÓSTICO**

### **✅ O QUE JÁ ESTÁ CORRETO:**
1. ✅ Mobile app já aponta para servidor local
2. ✅ Estrutura de serviços está correta
3. ✅ Rotas de pagamento implementadas
4. ✅ Configuração do WooviService usa ApiConfig

### **⚠️ O QUE PRECISA SER AJUSTADO:**
1. ⚠️ **webhookUrl** em `config/woovi-sandbox.js` (aponta para VPS)
2. ⚠️ **Webhook na Woovi** (precisa apontar para servidor local via ngrok)
3. ⚠️ **Variáveis de ambiente** (opcional, mas recomendado)

### **🎯 PRIORIDADE:**
1. **ALTA:** Ajustar webhookUrl no backend
2. **ALTA:** Configurar ngrok e atualizar webhook na Woovi
3. **MÉDIA:** Adicionar variáveis de ambiente

---

## 💡 **RECOMENDAÇÃO FINAL**

**Para testar pagamento antecipado no servidor local:**

1. ✅ **Ajustar webhookUrl** em `config/woovi-sandbox.js` para servidor local
2. ✅ **Configurar ngrok** para expor servidor local publicamente
3. ✅ **Atualizar webhook na Woovi** para URL do ngrok
4. ✅ **Testar criação de cobrança** via mobile app
5. ✅ **Verificar recebimento de webhook** nos logs do servidor

**Estrutura dos serviços está correta, apenas precisa ajustar URLs!**

---

**Última atualização:** 2025-12-19
**Status:** ⚠️ **PRECISA AJUSTAR WEBHOOK URL**

