# 🚀 WOOVI WEBHOOK EVENTS - LEAF APP

## 📋 EVENTOS CONFIGURADOS

### **1. charge.confirmed**
- **Descrição:** Cobrança paga
- **Status:** `PAYMENT_CONFIRMED`
- **Ação:** Inicia busca por motoristas
- **Notificação:** "Seu pagamento foi confirmado! Estamos buscando um motorista para você."

### **2. charge.expired**
- **Descrição:** Cobrança Expirada
- **Status:** `PAYMENT_EXPIRED`
- **Ação:** Permite gerar novo PIX
- **Notificação:** "O tempo para pagamento expirou. Gere um novo PIX para continuar."

### **3. charge.created**
- **Descrição:** Nova Cobrança Criada
- **Status:** `PIX_GENERATED`
- **Ação:** Exibe QR Code para pagamento
- **Notificação:** "Seu PIX foi gerado! Escaneie o QR Code para pagar."

### **4. refund.received**
- **Descrição:** Reembolso concluído
- **Status:** `REFUND_PROCESSED`
- **Ação:** Processa reembolso
- **Notificação:** "Reembolso de R$ X.XX processado com sucesso."

### **5. charge.received**
- **Descrição:** Transação Pix Recebida
- **Status:** `PIX_RECEIVED`
- **Ação:** Processa pagamento recebido
- **Notificação:** "PIX recebido! Estamos processando seu pagamento."

### **6. notthesame**
- **Descrição:** Cobrança paga por outra pessoa
- **Status:** `PAYMENT_BY_ANOTHER`
- **Ação:** Requer intervenção do suporte
- **Notificação:** "Pagamento realizado por outra pessoa. Entre em contato com o suporte."

## 🔧 CONFIGURAÇÃO NO DASHBOARD WOOVI

### **URL do Webhook:**
```
https://us-central1-leaf-reactnative.cloudfunctions.net/woovi_webhook
```

### **Eventos Configurados:**
1. `charge.confirmed` → Leaf-charge.confirmed
2. `charge.expired` → Leaf-charge.expired
3. `charge.created` → Leaf-charge.created
4. `refund.received` → Leaf-refund.received
5. `charge.received` → Leaf-charge.received
6. `notthesame` → Leaf-notthesame

## 📊 FLUXO DE PROCESSAMENTO

```
1. Woovi envia webhook
2. Nós validamos os dados
3. Nós processamos o evento
4. Nós atualizamos o banco
5. Nós notificamos o cliente
6. Nós retornamos 200 OK
```

## 🎯 STATUS DA CORRIDA

### **Status Possíveis:**
- `PIX_GENERATED` - PIX gerado, aguardando pagamento
- `PIX_RECEIVED` - PIX recebido, processando
- `PAYMENT_CONFIRMED` - Pagamento confirmado, buscando motorista
- `PAYMENT_EXPIRED` - Pagamento expirado
- `REFUND_PROCESSED` - Reembolso processado
- `PAYMENT_BY_ANOTHER` - Pagamento por outra pessoa
- `DRIVER_SEARCH_STARTED` - Buscando motorista
- `DRIVER_ACCEPTED` - Motorista aceitou
- `TRIP_STARTED` - Viagem iniciada
- `TRIP_COMPLETED` - Viagem concluída

## 🧪 TESTES

### **Testar Todos os Eventos:**
```bash
node scripts/testing/test-all-woovi-events.cjs
```

### **Testar Evento Específico:**
```bash
node scripts/testing/test-webhook-processing.cjs
```

## 📝 LOGS

### **Logs Importantes:**
- `Webhook Woovi recebido:` - Recebimento do webhook
- `Processando [evento]:` - Início do processamento
- `Status da corrida atualizado:` - Atualização no banco
- `Notificação enviada:` - Notificação para cliente
- `[Evento] processado com sucesso` - Conclusão do processamento

## 🔍 MONITORAMENTO

### **Firebase Console:**
1. Acesse: https://console.firebase.google.com
2. Projeto: `leaf-reactnative`
3. Functions → Logs
4. Filtre por: `woovi_webhook`

### **Métricas Importantes:**
- Tempo de resposta do webhook
- Taxa de sucesso dos eventos
- Erros de processamento
- Notificações enviadas

## 🚨 TRATAMENTO DE ERROS

### **Erros Comuns:**
- `Corrida não encontrada` - correlationID inválido
- `Erro ao processar [evento]` - Falha no processamento
- `Erro ao notificar cliente` - Falha na notificação

### **Ações:**
- Logs detalhados no Firebase Console
- Retry automático pelo Woovi (se 500)
- Monitoramento manual se necessário

## 📞 SUPORTE

### **Em Caso de Problemas:**
1. Verificar logs no Firebase Console
2. Testar webhook manualmente
3. Verificar configuração no dashboard Woovi
4. Contatar suporte se necessário

---

**✅ TODOS OS EVENTOS CONFIGURADOS E FUNCIONAIS!** 🚀 