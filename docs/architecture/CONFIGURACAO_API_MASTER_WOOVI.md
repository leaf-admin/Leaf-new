# 🔑 Configuração API MASTER Woovi - Guia de Ativação

## 📅 Data: 15 de Janeiro de 2025
## 🎯 Status: ⏳ **AGUARDANDO ATIVAÇÃO**

---

## 📋 Resumo

Este documento descreve o que precisa ser configurado quando a API MASTER da Woovi estiver disponível após a call com o time da Woovi.

---

## ✅ O que já está pronto

1. **Código implementado** com endpoints corretos da Woovi
2. **Fallback automático** para customer quando API MASTER não está configurada
3. **Webhook handler** para `ACCOUNT_REGISTER_APPROVED`
4. **Script de atualização** para motoristas existentes

---

## 🔧 Configurações Necessárias

### 1. Variáveis de Ambiente

Após receber a API MASTER da Woovi, adicionar no `.env` ou variáveis de ambiente:

```bash
# API MASTER (receber da Woovi na call)
WOOVI_MASTER_API_TOKEN=your_master_api_token_here
WOOVI_MASTER_APP_ID=your_master_app_id_here

# Chave Pix da conta Leaf (origem das transferências)
LEAF_PIX_KEY=your_leaf_pix_key@leaf.app.br

# Account ID da conta Leaf (opcional)
LEAF_WOOVI_ACCOUNT_ID=leaf-main-account
```

### 2. Configurar Webhook na Woovi

Após ativação, configurar webhook para:
- **URL**: `https://seu-servidor.com/api/woovi/webhook`
- **Eventos**:
  - `ACCOUNT_REGISTER_APPROVED` (novo - para contas BaaS)
  - `Leaf-charge.created`
  - `Leaf-charge.confirmed`
  - `Leaf-charge.expired`
  - `Leaf-refund.received`

---

## 🔄 Fluxo Após Ativação

### 1. Novos Motoristas

Quando um novo motorista for aprovado:
- ✅ Sistema tentará criar conta BaaS automaticamente
- ✅ Se API MASTER estiver configurada, cria conta BaaS real
- ✅ Aguarda aprovação da Woovi (webhook)
- ✅ Cria API e chave Pix automaticamente

### 2. Motoristas Existentes (Fallback)

Motoristas criados antes da API MASTER terão:
- `fallbackToCustomer: true`
- `baasUpgradePending: true`

**Para atualizar para BaaS:**

```bash
# Atualizar um motorista específico
node leaf-websocket-backend/scripts/upgrade-driver-to-baas.js <driverId>

# Atualizar todos os motoristas
node leaf-websocket-backend/scripts/upgrade-driver-to-baas.js --all
```

---

## 📝 Checklist da Call com Woovi

### Informações a Solicitar:

- [ ] **API MASTER Token** (`WOOVI_MASTER_API_TOKEN`)
- [ ] **API MASTER App ID** (`WOOVI_MASTER_APP_ID`)
- [ ] **Chave Pix da conta Leaf** (ou como criar)
- [ ] **Tempo de aprovação** de contas BaaS (geralmente instantâneo ou alguns minutos)
- [ ] **Limites de criação** de contas (se houver)
- [ ] **Webhook URL** para configurar
- [ ] **Documentação adicional** sobre BaaS (se houver)

### Perguntas Importantes:

1. **Aprovação de contas**: É automática ou manual? Quanto tempo leva?
2. **Chaves Pix**: Como criar chave Pix para a conta Leaf principal?
3. **Transferências**: Há algum limite diário/mensal para transferências?
4. **Taxas**: Há taxas adicionais para contas BaaS ou transferências?
5. **Sandbox vs Produção**: As credenciais de sandbox funcionam para BaaS?

---

## 🧪 Testes Após Configuração

### 1. Testar Criação de Conta BaaS

```bash
# Rodar teste completo
cd leaf-websocket-backend
node scripts/test-baas-flow.js
```

### 2. Verificar Webhook

- Aprovar um motorista de teste
- Verificar se webhook `ACCOUNT_REGISTER_APPROVED` é recebido
- Verificar se API e chave Pix são criadas automaticamente

### 3. Testar Transferência

- Finalizar uma corrida de teste
- Verificar se transferência é realizada com sucesso
- Verificar se motorista recebe o valor líquido

---

## 📚 Documentação de Referência

- **BaaS Woovi**: https://developers.woovi.com/docs/category/baas
- **Transferências**: https://developers.woovi.com/docs/transfer/how-to-transfer-values-between-accounts
- **Split**: https://developers.woovi.com/docs/category/split

---

## ⚠️ Notas Importantes

1. **Fallback Ativo**: Enquanto API MASTER não estiver configurada, o sistema usa fallback (customer) automaticamente
2. **Atualização Automática**: Quando API MASTER estiver disponível, novos motoristas terão contas BaaS automaticamente
3. **Motoristas Existentes**: Podem ser atualizados usando o script `upgrade-driver-to-baas.js`
4. **Webhook**: É essencial configurar o webhook para aprovação automática de contas

---

## 🚀 Próximos Passos

1. ✅ **Aguardar call com Woovi** (amanhã)
2. ⏳ **Receber credenciais API MASTER**
3. ⏳ **Configurar variáveis de ambiente**
4. ⏳ **Configurar webhook na Woovi**
5. ⏳ **Testar criação de conta BaaS**
6. ⏳ **Atualizar motoristas existentes** (se necessário)

---

**Status**: ⏳ Aguardando ativação da API MASTER pela Woovi

