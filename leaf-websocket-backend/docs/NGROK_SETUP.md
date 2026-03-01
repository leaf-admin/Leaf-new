# 🚀 Configuração do ngrok para Servidor Local

## 📅 Data: 2025-12-19
## 🎯 Objetivo: Expor servidor local para receber webhooks da Woovi

---

## 📋 **INSTALAÇÃO**

### **Opção 1: Via npm (Recomendado)**
```bash
npm install -g ngrok
```

### **Opção 2: Via Homebrew (macOS)**
```bash
brew install ngrok
```

### **Opção 3: Via Snap (Linux)**
```bash
snap install ngrok
```

### **Opção 4: Download Manual**
Baixar de: https://ngrok.com/download

---

## 🔑 **AUTENTICAÇÃO**

O ngrok requer autenticação gratuita:

1. Criar conta em: https://dashboard.ngrok.com/signup
2. Fazer login no dashboard
3. Copiar authtoken de: https://dashboard.ngrok.com/get-started/your-authtoken
4. Configurar:
   ```bash
   ngrok config add-authtoken SEU_TOKEN_AQUI
   ```

---

## 🚀 **USO RÁPIDO**

### **1. Script Automatizado (Recomendado)**

```bash
# Instalar e configurar ngrok
npm run setup:ngrok
# OU
./scripts/utils/setup-ngrok.sh

# Iniciar ngrok
npm run ngrok:start
# OU
node scripts/utils/start-ngrok.js

# Obter URL do ngrok
npm run ngrok:url
# OU
node scripts/utils/get-ngrok-url.js
```

### **2. Manual**

```bash
# Iniciar ngrok na porta 3001
ngrok http 3001

# OU com região específica
ngrok http 3001 --region us
```

---

## 📋 **CONFIGURAÇÃO COMPLETA**

### **Passo 1: Iniciar ngrok**

```bash
cd leaf-websocket-backend
npm run ngrok:start
```

**Saída esperada:**
```
🚀 Iniciando ngrok...
   Porta: 3001
   Região: us

🔧 Iniciando túnel ngrok...

Session Status                online
Account                       seu-email@example.com
Version                       3.x.x
Region                        United States (us)
Latency                       -
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://abc123.ngrok-free.app -> http://localhost:3001

═══════════════════════════════════════════════════════════
✅ NGROK INICIADO COM SUCESSO!
═══════════════════════════════════════════════════════════

🌐 URL Pública: https://abc123.ngrok-free.app
🔗 Webhook URL: https://abc123.ngrok-free.app/api/woovi/webhook
```

### **Passo 2: Configurar Variável de Ambiente**

```bash
# Copiar a URL do webhook da saída do ngrok
export WOOVI_WEBHOOK_URL="https://abc123.ngrok-free.app/api/woovi/webhook"

# OU adicionar ao .env
echo "WOOVI_WEBHOOK_URL=https://abc123.ngrok-free.app/api/woovi/webhook" >> .env
```

### **Passo 3: Configurar Webhook na Woovi**

1. Acessar: https://app.woovi.com/ (Sandbox)
2. Ir em: **Configurações > Webhooks**
3. Criar novo webhook:
   - **Nome**: Leaf Local Webhook
   - **URL**: `https://abc123.ngrok-free.app/api/woovi/webhook`
   - **Eventos**:
     - `OPENPIX:CHARGE_COMPLETED`
     - `OPENPIX:CHARGE_CREATED`
     - `OPENPIX:CHARGE_EXPIRED`
     - `PIX_TRANSACTION_REFUND_RECEIVED_CONFIRMED`

### **Passo 4: Reiniciar Servidor (se necessário)**

```bash
# Se usar PM2
pm2 restart leaf-server

# OU se rodar diretamente
npm start
```

---

## 🧪 **TESTAR CONFIGURAÇÃO**

### **1. Verificar URL do ngrok**

```bash
npm run ngrok:url
```

### **2. Testar Webhook Manualmente**

```bash
# Simular webhook da Woovi
curl -X POST https://abc123.ngrok-free.app/api/woovi/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "OPENPIX:CHARGE_COMPLETED",
    "charge": {
      "identifier": "test_charge_123",
      "status": "COMPLETED",
      "value": 5000
    }
  }'
```

### **3. Verificar Logs do Servidor**

Os logs devem mostrar:
```
🔔 [Webhook] Recebido: {
  event: 'OPENPIX:CHARGE_COMPLETED',
  chargeId: 'test_charge_123',
  status: 'COMPLETED',
  amount: '50.00'
}
```

---

## 📊 **MONITORAMENTO**

### **Interface Web do ngrok**

Acessar: http://127.0.0.1:4040

Mostra:
- Requisições recebidas
- Status do túnel
- Logs em tempo real
- Replay de requisições

### **Verificar Status**

```bash
# Ver URL atual
npm run ngrok:url

# Ver processos ngrok
ps aux | grep ngrok
```

---

## ⚠️ **LIMITAÇÕES DO PLANO GRATUITO**

- **Sessões limitadas**: 2 horas por sessão
- **URLs temporárias**: Mudam a cada reinício (exceto com plano pago)
- **Limite de conexões**: 40 conexões simultâneas
- **Bandwidth**: 1GB/mês

**Solução para URLs fixas:**
- Usar plano pago do ngrok
- OU configurar webhook manualmente a cada reinício

---

## 🔧 **TROUBLESHOOTING**

### **Problema: ngrok não inicia**

**Solução:**
```bash
# Verificar se está instalado
which ngrok

# Verificar autenticação
ngrok config check

# Reconfigurar authtoken
ngrok config add-authtoken SEU_TOKEN
```

### **Problema: Webhook não chega**

**Verificações:**
1. ✅ ngrok está rodando?
2. ✅ URL está correta na Woovi?
3. ✅ Servidor está rodando na porta 3001?
4. ✅ Rota `/api/woovi/webhook` está registrada?

**Testar:**
```bash
# Testar webhook manualmente
curl -X POST https://SUA_URL_NGROK/api/woovi/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### **Problema: URL muda a cada reinício**

**Solução:**
- Usar variável de ambiente `WOOVI_WEBHOOK_URL`
- Atualizar webhook na Woovi quando URL mudar
- OU usar plano pago do ngrok para URL fixa

---

## 📝 **SCRIPTS DISPONÍVEIS**

```bash
# Instalar e configurar ngrok
npm run setup:ngrok

# Iniciar ngrok
npm run ngrok:start

# Obter URL do ngrok
npm run ngrok:url

# Iniciar com porta específica
node scripts/utils/start-ngrok.js --port 3001

# Iniciar com região específica
node scripts/utils/start-ngrok.js --port 3001 --region us
```

---

## 🎯 **WORKFLOW RECOMENDADO**

1. **Iniciar servidor:**
   ```bash
   npm start
   ```

2. **Em outro terminal, iniciar ngrok:**
   ```bash
   npm run ngrok:start
   ```

3. **Copiar URL do webhook:**
   ```bash
   npm run ngrok:url
   ```

4. **Configurar variável de ambiente:**
   ```bash
   export WOOVI_WEBHOOK_URL="https://abc123.ngrok-free.app/api/woovi/webhook"
   ```

5. **Configurar webhook na Woovi Dashboard**

6. **Testar pagamento antecipado**

---

**Última atualização:** 2025-12-19
**Status:** ✅ **PRONTO PARA USO**

