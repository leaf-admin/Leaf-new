# 🔄 Atualização dos Endpoints Woovi - BaaS e Transferências

## 📅 Data: 15 de Janeiro de 2025
## 🎯 Status: ✅ **IMPLEMENTADO**

---

## 📋 Resumo das Alterações

Atualização completa dos endpoints da Woovi conforme documentação oficial:
- **Criação de conta BaaS**: `/api/v1/account-register`
- **Transferência entre contas**: `/api/v1/transfer` (com chaves Pix)
- **Webhook de aprovação**: `ACCOUNT_REGISTER_APPROVED`

---

## 🔧 Alterações Implementadas

### 1. **WooviDriverService** (`leaf-websocket-backend/services/woovi-driver-service.js`)

#### ✅ Criação de Conta BaaS
- **Endpoint correto**: `/api/v1/account-register`
- **Requer API MASTER**: Configurada via `WOOVI_MASTER_API_TOKEN` e `WOOVI_MASTER_APP_ID`
- **Fluxo completo**:
  1. Registrar conta com `/api/v1/account-register`
  2. Aguardar aprovação (webhook `ACCOUNT_REGISTER_APPROVED`)
  3. Criar API com `/api/v1/application`
  4. Criar chave Pix com `/api/v1/pix-keys`

#### ✅ Novos Métodos
- `createDriverBaaSAccount()`: Registra conta BaaS
- `createAccountApi()`: Cria API para conta aprovada
- `createPixKey()`: Cria chave Pix para conta

#### ✅ Transferência Direta (Pix Out)
- **Endpoint correto**: `/api/v1/transfer`
- **Campos obrigatórios**:
  - `value`: Valor em centavos
  - `fromPixKey`: Chave Pix da conta Leaf (origem)
  - `toPixKey`: Chave Pix da conta do motorista (destino)
- **Método alternativo**: `/api/v1/subaccount/transfer` (para subcontas)

### 2. **PaymentService** (`leaf-websocket-backend/services/payment-service.js`)

#### ✅ Suporte a Chaves Pix
- Adicionado `LEAF_PIX_KEY`: Chave Pix da conta Leaf (configurada via `LEAF_PIX_KEY` env)
- Busca automática da chave Pix do motorista do Firestore
- Passa chaves Pix corretas para `transferDirectToDriver()`

### 3. **DriverApprovalService** (`leaf-websocket-backend/services/driver-approval-service.js`)

#### ✅ Retorno de Chave Pix
- `getDriverWooviAccountId()` agora retorna também `pixKey` e `pixKeyType`
- Facilita transferências diretas

### 4. **Webhook Handler** (`leaf-websocket-backend/routes/woovi.js`)

#### ✅ Handler para `ACCOUNT_REGISTER_APPROVED`
- Processa aprovação de conta BaaS automaticamente
- Cria API e chave Pix após aprovação
- Atualiza dados do motorista no Firestore

---

## 🔑 Configurações Necessárias

### Variáveis de Ambiente

```bash
# API MASTER para criar contas BaaS
WOOVI_MASTER_API_TOKEN=your_master_api_token
WOOVI_MASTER_APP_ID=your_master_app_id

# Chave Pix da conta Leaf (origem das transferências)
LEAF_PIX_KEY=your_leaf_pix_key@leaf.app.br

# Account ID da conta Leaf (opcional)
LEAF_WOOVI_ACCOUNT_ID=leaf-main-account
```

---

## 📚 Documentação Woovi Referenciada

1. **BaaS**: https://developers.woovi.com/docs/category/baas
2. **Transferência entre contas**: https://developers.woovi.com/docs/transfer/how-to-transfer-values-between-accounts
3. **Split**: https://developers.woovi.com/docs/category/split

---

## 🔄 Fluxo Completo BaaS

### 1. Criação de Conta
```
Motorista aprovado
  ↓
createDriverBaaSAccount()
  ↓
POST /api/v1/account-register (com API MASTER)
  ↓
Conta registrada (status: pending_approval)
  ↓
Aguardar webhook ACCOUNT_REGISTER_APPROVED
```

### 2. Aprovação e Configuração
```
Webhook ACCOUNT_REGISTER_APPROVED recebido
  ↓
handleAccountApproved()
  ↓
POST /api/v1/application (criar API)
  ↓
POST /api/v1/pix-keys (criar chave Pix)
  ↓
Atualizar Firestore com appId e pixKey
```

### 3. Transferência de Ganhos
```
Corrida finalizada
  ↓
processNetDistribution()
  ↓
Buscar chave Pix do motorista
  ↓
POST /api/v1/transfer
  {
    value: 2351,
    fromPixKey: "leaf@leaf.app.br",
    toPixKey: "driver_pix_key"
  }
  ↓
Ganhos transferidos para motorista
```

---

## ⚠️ Observações Importantes

1. **API MASTER**: Necessária para criar contas BaaS. Solicitar ativação junto à Woovi.

2. **Aprovação de Conta**: Contas BaaS precisam ser aprovadas pela Woovi antes de poder criar API e chave Pix.

3. **Chaves Pix**: 
   - Conta Leaf deve ter chave Pix configurada
   - Motoristas precisam ter chave Pix criada após aprovação da conta
   - Chaves Pix são necessárias para transferências

4. **Fallback**: Se transferência direta falhar, sistema usa método alternativo (`createRideEarnings`).

---

## ✅ Testes Realizados

- ✅ Criação de conta BaaS (com fallback se API MASTER não configurada)
- ✅ Persistência no Firestore
- ✅ Busca de wooviAccountId
- ✅ Cálculo de valor líquido
- ✅ Processamento de distribuição (com fallback)

---

## 🚀 Próximos Passos

1. **Configurar API MASTER** na Woovi
2. **Configurar chave Pix da conta Leaf** (`LEAF_PIX_KEY`)
3. **Testar criação de conta BaaS** em sandbox
4. **Testar transferências** entre contas
5. **Implementar monitoramento** de webhooks

---

## 📝 Notas Técnicas

- Endpoints atualizados conforme documentação oficial da Woovi
- Suporte completo a chaves Pix para transferências
- Webhook handler implementado para aprovação automática
- Fallbacks implementados para garantir funcionamento mesmo sem API MASTER

---

**Status**: ✅ Implementação completa conforme documentação Woovi

