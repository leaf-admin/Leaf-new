# 🎯 Cloudflare - Configuração Simplificada (Campos Limitados)

## ⚠️ Problema
Rate Limiting Rules no Cloudflare tem campos limitados (só URI Path, Verified Bot, etc.)

## ✅ Solução: Usar 2 Tipos de Regras

### Parte 1: Rate Limiting Rule (Simples)

1. **Security → Security rules → Rate limiting rules**
2. **Create rule**
3. Configure:
   - **Rule name**: `Waitlist Rate Limit`
   - **When incoming requests match**:
     - **Field**: `URI Path`
     - **Operator**: `equals`
     - **Value**: `/api/waitlist/landing`
   - **Then**:
     - **Action**: `Rate limit`
     - **Rate**: `3 requests per 1 hour`
     - **Duration**: `1 hour`
4. **Save**

### Parte 2: Firewall Rule (Validação Completa)

1. **Security → Security rules → Custom rules** (ou **Firewall Rules**)
2. **Create rule**
3. Configure:

**Regra 1 - Permitir POST da Origem Correta:**
- **Rule name**: `Allow Waitlist POST from Leaf`
- **If**:
  - **Field**: `URI Path`
  - **Operator**: `equals`
  - **Value**: `/api/waitlist/landing`
  - **AND** (clique em Add):
    - **Field**: `Request Method`
    - **Operator**: `equals`
    - **Value**: `POST`
  - **AND** (clique em Add):
    - **Field**: `HTTP Request Header`
    - **Header name**: `origin`
    - **Operator**: `equals`
    - **Value**: `https://leaf.app.br`
- **Then**:
  - **Action**: `Allow`
  - **Priority**: `1`

**Regra 2 - Bloquear Outros:**
- **Rule name**: `Block Waitlist POST from Others`
- **If**:
  - **Field**: `URI Path`
  - **Operator**: `equals`
  - **Value**: `/api/waitlist/landing`
  - **AND**:
    - **Field**: `Request Method`
    - **Operator**: `equals`
    - **Value**: `POST`
  - **AND**:
    - **Field**: `HTTP Request Header`
    - **Header name**: `origin`
    - **Operator**: `does not equal`
    - **Value**: `https://leaf.app.br`
- **Then**:
  - **Action**: `Block`
  - **Priority**: `2`

## 🎯 Resumo

**Rate Limiting Rule:**
- Apenas URI Path = `/api/waitlist/landing`
- Limite: 3 por hora

**Firewall Rules (Custom Rules):**
- Regra 1: Permitir POST de `https://leaf.app.br`
- Regra 2: Bloquear POST de outras origens

## ✅ Ordem de Avaliação

1. **Firewall Rules** são avaliadas primeiro (permitir/bloquear)
2. **Rate Limiting** é aplicado depois (limitar requisições permitidas)

Isso garante que:
- Requisições de origem errada são bloqueadas imediatamente
- Requisições de origem correta são limitadas a 3 por hora






















