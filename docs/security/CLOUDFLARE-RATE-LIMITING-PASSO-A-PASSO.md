# 🎯 Cloudflare Rate Limiting - Passo a Passo EXATO

## 📍 Caminho no Seu Painel

1. **Security** (menu lateral)
2. **Security rules**
3. **Rate limiting rules**

## ✅ Configuração Passo a Passo

### Passo 1: Criar a Regra

1. Clique em **Rate limiting rules**
2. Clique no botão **Create rule** (geralmente no canto superior direito)

### Passo 2: Configurar a Regra

#### Aba "Rule name"
- **Rule name**: `Waitlist Protection`

#### Aba "When incoming requests match" (ou "If")
Configure as condições:

**Condição 1:**
- **Field**: `URI Path` (ou `Request URI Path`)
- **Operator**: `equals` (ou `is`)
- **Value**: `/api/waitlist/landing`

**Condição 2 (clique em "Add" ou "AND"):**
- **Field**: `Request Method` (ou `HTTP Method`)
- **Operator**: `equals` (ou `is`)
- **Value**: `POST`

**Condição 3 (opcional, mas recomendado - clique em "Add" ou "AND"):**
- **Field**: `HTTP Request Header`
- **Header name**: `origin`
- **Operator**: `equals` (ou `is`)
- **Value**: `https://leaf.app.br`

#### Aba "Then" (ou "Action")
- **Action**: `Rate limit` (ou `Block` se não tiver rate limit)
- **Rate**: `3 requests per 1 hour` (ou `3 per hour`)
- **Duration**: `1 hour` (ou `3600 seconds`)

### Passo 3: Salvar

1. Clique em **Save** ou **Deploy**
2. Aguarde alguns segundos para a regra ser aplicada

## 🛡️ Regra Adicional (Recomendado): Bloquear Outras Origens

Crie uma segunda regra para bloquear requisições de outras origens:

### Regra 2: Bloquear Origem Diferente

1. Clique em **Create rule** novamente
2. **Rule name**: `Block Waitlist from Other Origins`

**Condições:**
- **URI Path** `equals` `/api/waitlist/landing`
- **AND Request Method** `equals` `POST`
- **AND HTTP Request Header** `origin` `does not equal` `https://leaf.app.br`

**Action:**
- **Action**: `Block`
- **Priority**: `2` (menor que a primeira regra)

## ✅ Verificação

Após configurar, teste:

```bash
# Deve funcionar (origem correta)
curl -X POST https://leaf.app.br/api/waitlist/landing \
  -H "Content-Type: application/json" \
  -H "Origin: https://leaf.app.br" \
  -d '{"nome":"Teste","celular":"11999999999","cidade":"São Paulo"}'
```

## 📝 Resumo Rápido

**Regra 1 (Permitir com Rate Limit):**
- URI = `/api/waitlist/landing`
- Method = `POST`
- Origin = `https://leaf.app.br`
- Action = `Rate limit: 3 per hour`

**Regra 2 (Bloquear outras origens):**
- URI = `/api/waitlist/landing`
- Method = `POST`
- Origin ≠ `https://leaf.app.br`
- Action = `Block`

## ⚠️ Importante

- A **Regra 1** deve ter **Priority maior** (número menor, ex: 1)
- A **Regra 2** deve ter **Priority menor** (número maior, ex: 2)
- Isso garante que a regra de permitir seja avaliada primeiro

## 🎯 Se Não Funcionar

Se ainda retornar 405, verifique:
1. Se a regra está **ativa** (status "Enabled")
2. Se o **priority** está correto
3. Aguarde 1-2 minutos para a regra propagar
4. Teste novamente






















