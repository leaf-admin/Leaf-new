# 🔍 Verificar Regra Cloudflare - Passo a Passo

## ⚠️ Problema: Ainda retorna 405 mesmo com regras ativas

## ✅ Verificações Necessárias

### 1. Verificar Expressão da Custom Rule

A expressão deve ser **EXATAMENTE** assim (copie e cole):

```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and all(http.request.headers["origin"][*] ne "https://leaf.app.br"))
```

**Pontos importantes:**
- `/api/waitlist/landing` (com barra no início)
- `"POST"` (maiúsculas)
- `"origin"` (minúsculas, sem aspas no nome do header)
- `"https://leaf.app.br"` (com https://)

### 2. Verificar Prioridade

- A Custom Rule deve ter **Priority** configurada
- Se houver outras regras, essa deve ter prioridade **alta** (número baixo, ex: 1)

### 3. Verificar Action

- **Action** deve ser `Block`
- **Status** deve ser `Enabled` ou `Active`

### 4. Testar Expressão

No painel Cloudflare, há uma opção de **"Test expression"** ou **"Preview"**. Use para testar:

**Teste 1 (deve BLOQUEAR):**
- URI: `/api/waitlist/landing`
- Method: `POST`
- Header origin: `https://evil.com`
- Resultado esperado: **Block**

**Teste 2 (deve PERMITIR):**
- URI: `/api/waitlist/landing`
- Method: `POST`
- Header origin: `https://leaf.app.br`
- Resultado esperado: **Allow** (não bloqueado)

## 🔧 Alternativa: Simplificar a Regra

Se a expressão complexa não funcionar, tente uma regra mais simples:

### Regra Simplificada (Bloquear tudo exceto se tiver origin correto)

**Expressão:**
```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and not http.request.headers["origin"])
```

**Action:** `Block`

Isso bloqueia requisições POST sem header origin. Requisições com origin `https://leaf.app.br` passarão.

## 🎯 Solução Temporária: Desabilitar Proxy

Para testar se o problema é só a Cloudflare:

1. Vá em **DNS**
2. Clique no ícone de proxy (nuvem laranja) ao lado de `leaf.app.br`
3. Mude para **DNS only** (nuvem cinza)
4. Aguarde 1-2 minutos
5. Teste: `curl -X POST https://leaf.app.br/api/waitlist/landing ...`

**Se funcionar sem proxy:**
- ✅ Problema está na Cloudflare
- ⏳ Aguarde mais tempo para propagação
- 🔄 Verifique expressão da regra

## 📝 Checklist Final

- [ ] Expressão está **exatamente** como mostrado acima?
- [ ] Regra está **Enabled/Active**?
- [ ] Aguardou **5-10 minutos** após criar a regra?
- [ ] Testou a expressão no preview/test do Cloudflare?
- [ ] Verificou se há outras regras conflitantes?

## 🆘 Se Nada Funcionar

Me diga:
1. Qual é a expressão **exata** que aparece na sua regra?
2. Qual é o **Status** da regra?
3. Há outras regras que podem estar interferindo?






















