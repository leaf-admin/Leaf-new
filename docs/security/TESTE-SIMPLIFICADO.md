# 🧪 Teste Simplificado - Isolar o Problema

## 🎯 Objetivo
Descobrir se o problema é a regra do Cloudflare ou o backend.

## ✅ Passo 1: Desabilitar Temporariamente a Custom Rule

1. Vá em **Security → Security rules → Custom rules**
2. Encontre a regra `Block Waitlist POST from Others`
3. Clique em **Edit**
4. Mude o **Status** para **Disabled** (ou delete temporariamente)
5. **Save**

## ✅ Passo 2: Manter Apenas Rate Limiting

Mantenha apenas a **Rate Limiting Rule** ativa:
- URI Path = `/api/waitlist/landing`
- Rate: 3 por hora

## ✅ Passo 3: Testar

```bash
curl -X POST https://leaf.app.br/api/waitlist/landing \
  -H "Content-Type: application/json" \
  -H "Origin: https://leaf.app.br" \
  -d '{"nome":"Teste","celular":"11999999999","cidade":"São Paulo"}'
```

**Se funcionar:**
- ✅ Backend está OK
- ✅ Problema está na Custom Rule
- 🔧 Precisamos ajustar a expressão

**Se ainda retornar 405:**
- ❌ Problema pode ser outra coisa
- 🔍 Verificar se há outras regras bloqueando

## 🔧 Se Funcionar: Ajustar Expressão

Se funcionar sem a Custom Rule, o problema é a expressão. Tente esta versão:

```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and http.request.headers["origin"][0] ne "https://leaf.app.br")
```

Ou esta (mais simples):

```
(http.request.uri.path eq "/api/waitlist/landing" and http.request.method eq "POST" and not http.request.headers["origin"])
```

Isso bloqueia requisições sem header origin (mais seguro).






















