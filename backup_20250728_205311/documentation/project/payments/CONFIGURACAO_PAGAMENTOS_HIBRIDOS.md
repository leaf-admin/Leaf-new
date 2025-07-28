# 💰 **CONFIGURAÇÃO DE PAGAMENTOS HÍBRIDOS - LEAF APP**

## 🎯 **ESTRATÉGIA DE PAGAMENTOS**

### **📱 PIX (Pagamento Instantâneo)**
- **Principal:** Woovi (OpenPix)
- **Fallback:** AbacatePay

### **💳 Cartão de Crédito**
- **Principal:** MercadoPago
- **Fallback:** PagSeguro

---

## 🔧 **CONFIGURAÇÃO DOS PROVEDORES**

### **1. WOOVI (PIX PRINCIPAL)**

#### **📋 Dados Necessários:**
- **App ID:** Obter em https://app.openpix.com.br
- **API Key:** Gerada automaticamente no dashboard

#### **⚙️ Configuração:**
```bash
# Adicionar ao .env.production
WOOVI_API_KEY=seu_woovi_api_key_aqui
WOOVI_APP_ID=seu_woovi_app_id_aqui
```

#### **🔗 URLs:**
- **Dashboard:** https://app.openpix.com.br
- **Documentação:** https://docs.openpix.com.br
- **Webhook:** `https://leaf-app-91dfdce0.cloudfunctions.net/woovi-webhook`

---

### **2. ABACATEPAY (PIX FALLBACK)**

#### **📋 Dados Necessários:**
- **API Key:** Obter em https://abacatepay.com.br
- **Secret Key:** Gerada no dashboard

#### **⚙️ Configuração:**
```bash
# Adicionar ao .env.production
ABACATEPAY_API_KEY=seu_abacatepay_api_key_aqui
ABACATEPAY_SECRET_KEY=seu_abacatepay_secret_key_aqui
```

#### **🔗 URLs:**
- **Dashboard:** https://abacatepay.com.br
- **Documentação:** https://docs.abacatepay.com.br
- **Webhook:** `https://leaf-app-91dfdce0.cloudfunctions.net/abacatepay-webhook`

---

### **3. MERCADOPAGO (CARTÃO PRINCIPAL)**

#### **📋 Dados Necessários:**
- **Public Key:** Obter em https://www.mercadopago.com.br/developers
- **Access Token:** Gerado no dashboard

#### **⚙️ Configuração:**
```bash
# Adicionar ao .env.production
MERCADOPAGO_PUBLIC_KEY=seu_mercadopago_public_key_aqui
MERCADOPAGO_ACCESS_TOKEN=seu_mercadopago_access_token_aqui
```

#### **🔗 URLs:**
- **Dashboard:** https://www.mercadopago.com.br/developers
- **Documentação:** https://www.mercadopago.com.br/developers/docs
- **Webhook:** `https://leaf-app-91dfdce0.cloudfunctions.net/mercadopago-webhook`

---

### **4. PAGSEGURO (CARTÃO FALLBACK)**

#### **📋 Dados Necessários:**
- **Email:** Email da conta PagSeguro
- **Token:** Gerado no dashboard
- **App ID:** (Opcional)
- **App Key:** (Opcional)

#### **⚙️ Configuração:**
```bash
# Adicionar ao .env.production
PAGSEGURO_EMAIL=seu_email_pagseguro@exemplo.com
PAGSEGURO_TOKEN=seu_pagseguro_token_aqui
PAGSEGURO_APP_ID=seu_pagseguro_app_id_aqui
PAGSEGURO_APP_KEY=seu_pagseguro_app_key_aqui
```

#### **🔗 URLs:**
- **Dashboard:** https://pagseguro.uol.com.br
- **Documentação:** https://dev.pagseguro.uol.com.br
- **Webhook:** `https://leaf-app-91dfdce0.cloudfunctions.net/pagseguro-webhook`

---

## 🧪 **TESTE DOS PROVEDORES**

### **Executar Teste Completo:**
```bash
cd scripts/testing
node test-hybrid-payments.cjs
```

### **Teste Individual:**
```bash
# Testar apenas PIX
node test-pix-providers.cjs

# Testar apenas Cartão
node test-card-providers.cjs
```

---

## 📊 **ESTRUTURA DE FALLBACK**

### **🔄 Fluxo PIX:**
```
1. Tentar Woovi
   ↓ (se falhar)
2. Tentar AbacatePay
   ↓ (se falhar)
3. Retornar erro
```

### **🔄 Fluxo Cartão:**
```
1. Tentar MercadoPago
   ↓ (se falhar)
2. Tentar PagSeguro
   ↓ (se falhar)
3. Retornar erro
```

---

## 💰 **CUSTOS E TAXAS**

### **📱 PIX:**
| Provedor | Taxa | Taxa Fixa | Prazo |
|----------|------|-----------|-------|
| Woovi | 1,99% | R$ 0,00 | Instantâneo |
| AbacatePay | 2,49% | R$ 0,00 | Instantâneo |

### **💳 Cartão:**
| Provedor | Taxa | Taxa Fixa | Prazo |
|----------|------|-----------|-------|
| MercadoPago | 4,99% | R$ 0,00 | 1-2 dias |
| PagSeguro | 4,99% | R$ 0,00 | 1-2 dias |

---

## 🔐 **WEBHOOKS CONFIGURADOS**

### **📱 PIX Webhooks:**
- **Woovi:** `https://leaf-app-91dfdce0.cloudfunctions.net/woovi-webhook`
- **AbacatePay:** `https://leaf-app-91dfdce0.cloudfunctions.net/abacatepay-webhook`

### **💳 Cartão Webhooks:**
- **MercadoPago:** `https://leaf-app-91dfdce0.cloudfunctions.net/mercadopago-webhook`
- **PagSeguro:** `https://leaf-app-91dfdce0.cloudfunctions.net/pagseguro-webhook`

---

## 🚀 **DEPLOY DOS PROVEDORES**

### **1. Configurar Variáveis de Ambiente:**
```bash
# Editar mobile-app/apk/.env.production
nano mobile-app/apk/.env.production
```

### **2. Deploy das Functions:**
```bash
cd functions
firebase deploy --only functions:woovi-webhook,functions:abacatepay-webhook,functions:mercadopago-webhook,functions:pagseguro-webhook
```

### **3. Testar Sistema:**
```bash
cd scripts/testing
node test-hybrid-payments.cjs
```

---

## 📈 **MONITORAMENTO**

### **📊 Métricas Importantes:**
- **Taxa de Sucesso:** % de pagamentos aprovados
- **Tempo de Resposta:** Latência dos provedores
- **Uso de Fallback:** Frequência de uso dos provedores secundários
- **Erros:** Tipos e frequência de erros

### **🔍 Logs de Monitoramento:**
```bash
# Ver logs dos webhooks
firebase functions:log --only woovi-webhook,abacatepay-webhook,mercadopago-webhook,pagseguro-webhook

# Ver logs do sistema híbrido
firebase functions:log --only hybrid-payment
```

---

## ⚠️ **TROUBLESHOOTING**

### **❌ Problemas Comuns:**

#### **1. Woovi não responde:**
```bash
# Verificar configuração
echo $WOOVI_API_KEY
echo $WOOVI_APP_ID

# Testar conectividade
curl -H "AppId: $WOOVI_APP_ID" https://api.openpix.com.br/api/v1/charge
```

#### **2. MercadoPago com erro:**
```bash
# Verificar configuração
echo $MERCADOPAGO_PUBLIC_KEY
echo $MERCADOPAGO_ACCESS_TOKEN

# Testar API
curl -H "Authorization: Bearer $MERCADOPAGO_ACCESS_TOKEN" https://api.mercadopago.com/v1/payments
```

#### **3. Webhook não recebido:**
```bash
# Verificar logs
firebase functions:log --only woovi-webhook

# Testar webhook manualmente
curl -X POST https://leaf-app-91dfdce0.cloudfunctions.net/woovi-webhook \
  -H "Content-Type: application/json" \
  -d '{"test": "webhook"}'
```

---

## ✅ **CHECKLIST DE CONFIGURAÇÃO**

### **📋 Pré-requisitos:**
- [ ] Conta Woovi criada
- [ ] Conta AbacatePay criada
- [ ] Conta MercadoPago criada
- [ ] Conta PagSeguro criada
- [ ] API Keys obtidas
- [ ] Webhooks configurados

### **⚙️ Configuração:**
- [ ] Variáveis de ambiente configuradas
- [ ] Functions deployadas
- [ ] Testes executados
- [ ] Monitoramento ativo

### **🧪 Testes:**
- [ ] Teste PIX Woovi
- [ ] Teste PIX AbacatePay
- [ ] Teste Cartão MercadoPago
- [ ] Teste Cartão PagSeguro
- [ ] Teste Fallback PIX
- [ ] Teste Fallback Cartão

---

## 🎯 **PRÓXIMOS PASSOS**

### **1. Configurar Provedores:**
```bash
# Obter API Keys dos provedores
# Configurar no .env.production
# Deploy das functions
```

### **2. Testar Sistema:**
```bash
# Executar testes completos
cd scripts/testing
node test-hybrid-payments.cjs
```

### **3. Monitorar Produção:**
```bash
# Ativar monitoramento
cd scripts/monitoring
./payment-metrics.sh
```

---

## 📞 **SUPORTE**

### **🔗 Links Úteis:**
- **Woovi:** https://app.openpix.com.br/support
- **AbacatePay:** https://abacatepay.com.br/support
- **MercadoPago:** https://www.mercadopago.com.br/developers/support
- **PagSeguro:** https://dev.pagseguro.uol.com.br/support

### **📧 Contatos:**
- **Leaf App:** admin@leaf.app.br
- **Urgências:** +55 11 99999-9999

---

## ✅ **CONCLUSÃO**

**O sistema híbrido de pagamentos está configurado com:**
- ✅ **PIX:** Woovi + AbacatePay (fallback)
- ✅ **Cartão:** MercadoPago + PagSeguro (fallback)
- ✅ **Webhooks:** Configurados para todos os provedores
- ✅ **Testes:** Scripts de teste implementados
- ✅ **Monitoramento:** Sistema de métricas ativo

**Próximo passo:** Configurar as API Keys e testar o sistema! 🚀 