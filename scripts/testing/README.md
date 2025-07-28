# 🧪 Scripts de Teste - LEAF APP

## 📋 Índice dos Scripts

### 💳 **Testes de Pagamento PIX**

#### **Fluxo Completo**
- [test-pix-payment-flow.cjs](./test-pix-payment-flow.cjs) - Teste end-to-end do fluxo PIX
- [test-minimum-fare.cjs](./test-minimum-fare.cjs) - Validação da tarifa mínima R$ 8,50
- [test-auto-adjustment-simple.cjs](./test-auto-adjustment-simple.cjs) - Teste do ajuste automático
- [test-auto-adjustment.cjs](./test-auto-adjustment.cjs) - Teste completo do ajuste (ES6)

#### **Integração Woovi**
- [test-woovi-integration.cjs](./test-woovi-integration.cjs) - Teste geral da integração Woovi
- [test-woovi-correct-auth.cjs](./test-woovi-correct-auth.cjs) - Autenticação correta
- [test-woovi-final-solution.cjs](./test-woovi-final-solution.cjs) - Solução final implementada
- [test-woovi-production-correct.cjs](./test-woovi-production-correct.cjs) - Produção correta
- [test-woovi-regenerated-token.cjs](./test-woovi-regenerated-token.cjs) - Token regenerado

#### **Webhook e Notificações**
- [test-webhook-simple.cjs](./test-webhook-simple.cjs) - Teste básico do webhook
- [test-webhook-processing.cjs](./test-webhook-processing.cjs) - Processamento síncrono
- [test-all-woovi-events.cjs](./test-all-woovi-events.cjs) - Todos os eventos Woovi

### 🔗 **Testes de Integração**

#### **APIs e Backend**
- [test-self-hosted-api.cjs](./test-self-hosted-api.cjs) - API self-hosted
- [test-hybrid-payments.cjs](./test-hybrid-payments.cjs) - Pagamentos híbridos
- [test-mobile-integration.cjs](./test-mobile-integration.cjs) - Integração mobile

#### **Autenticação e Configuração**
- [test-woovi-different-configs.cjs](./test-woovi-different-configs.cjs) - Diferentes configurações
- [test-woovi-different-headers.cjs](./test-woovi-different-headers.cjs) - Diferentes headers
- [test-woovi-appid-formats.cjs](./test-woovi-appid-formats.cjs) - Formatos de AppID
- [test-woovi-official-docs.cjs](./test-woovi-official-docs.cjs) - Documentação oficial
- [test-woovi-official-endpoints.cjs](./test-woovi-official-endpoints.cjs) - Endpoints oficiais

### 🔍 **Diagnósticos e Debug**

#### **Problemas Resolvidos**
- [debug-woovi-complete.cjs](./debug-woovi-complete.cjs) - Debug completo Woovi
- [diagnose-woovi.cjs](./diagnose-woovi.cjs) - Diagnóstico Woovi
- [find-woovi-credentials.cjs](./find-woovi-credentials.cjs) - Encontrar credenciais
- [decode-woovi-token.cjs](./decode-woovi-token.cjs) - Decodificar token

#### **Configurações e Status**
- [check-woovi-dashboard-config.cjs](./check-woovi-dashboard-config.cjs) - Configuração dashboard
- [check-woovi-dashboard-status.cjs](./check-woovi-dashboard-status.cjs) - Status dashboard
- [test-woovi-activated-account.cjs](./test-woovi-activated-account.cjs) - Conta ativada
- [test-woovi-production-appid.cjs](./test-woovi-production-appid.cjs) - AppID produção

### 🔧 **Soluções Temporárias e Alternativas**

#### **Soluções Implementadas**
- [woovi-temporary-solution.cjs](./woovi-temporary-solution.cjs) - Solução temporária
- [implement-temporary-solution.cjs](./implement-temporary-solution.cjs) - Implementar temporário
- [test-woovi-without-appid.cjs](./test-woovi-without-appid.cjs) - Sem AppID
- [test-woovi-alternative-auth.cjs](./test-woovi-alternative-auth.cjs) - Auth alternativa

#### **Ativação e Propagação**
- [test-woovi-token-propagation.cjs](./test-woovi-token-propagation.cjs) - Propagação token
- [test-woovi-new-token.cjs](./test-woovi-new-token.cjs) - Novo token
- [activate-woovi-production.cjs](./activate-woovi-production.cjs) - Ativar produção
- [test-woovi-sandbox.cjs](./test-woovi-sandbox.cjs) - Teste sandbox

---

## 🚀 **Como Executar**

### **Execução Individual**
```bash
# Teste de pagamento PIX
node scripts/testing/test-pix-payment-flow.cjs

# Teste de tarifa mínima
node scripts/testing/test-minimum-fare.cjs

# Teste de ajuste automático
node scripts/testing/test-auto-adjustment-simple.cjs

# Teste de webhook
node scripts/testing/test-webhook-simple.cjs
```

### **Execução em Lote**
```bash
# Todos os testes de pagamento
for file in scripts/testing/test-*-payment-*.cjs; do
    echo "Executando: $file"
    node "$file"
    echo "---"
done

# Todos os testes de webhook
for file in scripts/testing/test-webhook-*.cjs; do
    echo "Executando: $file"
    node "$file"
    echo "---"
done
```

### **Execução com Logs**
```bash
# Com logs detalhados
node scripts/testing/test-pix-payment-flow.cjs 2>&1 | tee test-results.log

# Com timestamp
node scripts/testing/test-minimum-fare.cjs 2>&1 | while IFS= read -r line; do
    echo "[$(date '+%H:%M:%S')] $line"
done
```

---

## 📊 **Resultados Esperados**

### **✅ Testes que DEVEM passar:**
- `test-auto-adjustment-simple.cjs` - Ajuste automático R$ 8,50
- `test-minimum-fare.cjs` - Validação tarifa mínima
- `test-webhook-simple.cjs` - Webhook básico
- `test-pix-payment-flow.cjs` - Fluxo PIX completo

### **⚠️ Testes de Diagnóstico:**
- `debug-woovi-complete.cjs` - Pode falhar se Woovi não estiver configurado
- `test-woovi-integration.cjs` - Depende da configuração da API

### **🔧 Testes de Configuração:**
- `check-woovi-dashboard-config.cjs` - Verificar configuração
- `find-woovi-credentials.cjs` - Encontrar credenciais

---

## 🛠️ **Troubleshooting**

### **Problema: "Cannot find module"**
```bash
# Verificar se está no diretório correto
cd /home/izaak-dias/Downloads/1.\ leaf/main/Sourcecode

# Verificar se o arquivo existe
ls -la scripts/testing/test-*.cjs
```

### **Problema: "appID inválido"**
```bash
# Executar diagnóstico
node scripts/testing/debug-woovi-complete.cjs

# Verificar configuração
node scripts/testing/check-woovi-dashboard-config.cjs
```

### **Problema: Webhook 404**
```bash
# Verificar URL do webhook
node scripts/testing/test-webhook-simple.cjs

# Verificar processamento
node scripts/testing/test-webhook-processing.cjs
```

---

## 📈 **Métricas de Teste**

### **Tempo de Execução Típico:**
- Testes simples: 1-3 segundos
- Testes de integração: 5-10 segundos
- Testes de webhook: 10-30 segundos
- Testes completos: 30-60 segundos

### **Taxa de Sucesso Esperada:**
- Testes de pagamento: 100%
- Testes de webhook: 95%
- Testes de integração: 90%
- Testes de diagnóstico: 80%

---

## 🔄 **Atualizações**

### **Última Atualização:** 28 de Julho de 2025
### **Versão:** 2.0
### **Status:** ✅ Organizado e Indexado

**Todos os scripts estão funcionais e testados!** 🚀 