# 🚨 CORREÇÃO URGENTE: Erro 403 Forbidden

## ⚠️ Problema
A URL `https://leaf.app.br/excluir-conta` está retornando **403 Forbidden**, impedindo validação pela Play Store.

## ✅ Soluções Aplicadas

### 1. Arquivos Criados para Cloudflare Pages

✅ **`_redirects`** - Redireciona `/excluir-conta` → `/excluir-conta.html`
✅ **`_headers`** - Configura headers de segurança permitindo acesso
✅ **`cloudflare-config.json`** - Configuração adicional para Cloudflare

### 2. Página Modificada

✅ Firebase carregado de forma assíncrona (não bloqueia página)
✅ Página sempre acessível (sem autenticação para visualização)
✅ Autenticação só necessária ao enviar formulário

---

## 🚀 AÇÃO NECESSÁRIA: Fazer Novo Deploy

### Passo 1: Verificar Arquivos

Certifique-se de que estes arquivos estão na pasta `landing-page/`:
- `excluir-conta.html`
- `_redirects`
- `_headers`
- `cloudflare-config.json`

### Passo 2: Fazer Deploy no Cloudflare Pages

**Opção A: Se usar Git**
```bash
cd landing-page
git add excluir-conta.html _redirects _headers cloudflare-config.json
git commit -m "Fix: Corrigir acesso à página de exclusão de conta (403 Forbidden)"
git push origin main
```

**Opção B: Upload Manual**
1. Acesse: https://dash.cloudflare.com/
2. Vá em **Pages** → Seu projeto
3. **Settings** → **Deployments**
4. **Retry deployment** ou faça novo upload

### Passo 3: Verificar no Cloudflare Dashboard

1. **Security** → **WAF**
   - Verifique se há regras bloqueando `/excluir-conta`
   - Se houver, adicione exceção

2. **Security** → **Firewall Rules**
   - Verifique regras que possam estar bloqueando

3. **Rules** → **Page Rules**
   - Certifique-se que HTML está permitido

### Passo 4: Testar URL

```bash
# Testar com cURL
curl -I https://leaf.app.br/excluir-conta

# Deve retornar:
# HTTP/2 200
# ou
# HTTP/2 301 (redirect)
```

---

## 🔍 Se Ainda Retornar 403

### Verificar Logs do Cloudflare
1. Dashboard → **Analytics** → **Logs**
2. Filtrar por `/excluir-conta`
3. Ver motivo do bloqueio

### Contatar Suporte Cloudflare
Se persistir, pode ser:
- Regra WAF bloqueando
- Firewall bloqueando
- Configuração de segurança

---

## ✅ Resultado Esperado

Após deploy correto:
- ✅ `https://leaf.app.br/excluir-conta` → **200 OK**
- ✅ Página carrega sem autenticação
- ✅ Formulário visível imediatamente
- ✅ Play Store consegue validar URL

---

**⚠️ IMPORTANTE: A página NÃO requer autenticação para visualização. Só precisa autenticar ao ENVIAR o formulário.**















