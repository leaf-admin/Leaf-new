# 🎯 Cloudflare - Configuração Final (Com Campo Header)

## ✅ Configuração Correta

### Regra 1: Rate Limiting (Simples)

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
   - **Save**

### Regra 2: Custom Rules - Permitir POST da Origem Correta

1. **Security → Security rules → Custom rules**
2. **Create rule**
3. Configure:

**Regra 1 - Permitir:**
- **Rule name**: `Allow Waitlist POST from Leaf`
- **If** (condições):
  1. **Field**: `URI Path`
     - **Operator**: `equals`
     - **Value**: `/api/waitlist/landing`
  
  2. **AND** (clique em Add):
     - **Field**: `Request Method`
     - **Operator**: `equals`
     - **Value**: `POST`
  
  3. **AND** (clique em Add):
     - **Field**: `Header` (ou `HTTP Request Header`)
     - **Header name**: `origin` (digite "origin" no campo)
     - **Operator**: `equals`
     - **Value**: `https://leaf.app.br`

- **Then**:
  - **Action**: `Allow`
  - **Priority**: `1` (alta)

4. **Save** ou **Deploy**

### Regra 3: Custom Rules - Bloquear Outras Origens

1. **Create rule** novamente
2. Configure:

**Regra 2 - Bloquear:**
- **Rule name**: `Block Waitlist POST from Others`
- **If** (condições):
  1. **Field**: `URI Path`
     - **Operator**: `equals`
     - **Value**: `/api/waitlist/landing`
  
  2. **AND**:
     - **Field**: `Request Method`
     - **Operator**: `equals`
     - **Value**: `POST`
  
  3. **AND**:
     - **Field**: `Header`
     - **Header name**: `origin` (digite "origin")
     - **Operator**: `does not equal` (ou `is not`)
     - **Value**: `https://leaf.app.br`

- **Then**:
  - **Action**: `Block`
  - **Priority**: `2` (média, menor que a primeira)

4. **Save** ou **Deploy**

## 📝 Resumo Visual

```
Rate Limiting Rule:
└─ URI Path = /api/waitlist/landing
└─ Limite: 3 por hora

Custom Rule 1 (Permitir):
├─ URI Path = /api/waitlist/landing
├─ Method = POST
├─ Header "origin" = https://leaf.app.br
└─ Action: Allow (Priority 1)

Custom Rule 2 (Bloquear):
├─ URI Path = /api/waitlist/landing
├─ Method = POST
├─ Header "origin" ≠ https://leaf.app.br
└─ Action: Block (Priority 2)
```

## ✅ Ordem de Execução

1. **Custom Rule 1** verifica se é POST da origem correta → **Permite**
2. **Custom Rule 2** verifica se é POST de outra origem → **Bloqueia**
3. **Rate Limiting** limita requisições permitidas → **3 por hora**

## 🎯 Importante

- No campo **Header**, digite exatamente: `origin` (minúsculas)
- No campo **Value**, digite: `https://leaf.app.br` (com https://)
- **Priority 1** = avaliada primeiro (permitir)
- **Priority 2** = avaliada depois (bloquear)

## ✅ Teste

Após configurar, aguarde 1-2 minutos e teste:

```bash
# Deve funcionar
curl -X POST https://leaf.app.br/api/waitlist/landing \
  -H "Content-Type: application/json" \
  -H "Origin: https://leaf.app.br" \
  -d '{"nome":"Teste","celular":"11999999999","cidade":"São Paulo"}'
```






















