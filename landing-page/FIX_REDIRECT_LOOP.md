# 🔄 Correção: Loop de Redirecionamento Infinito

## ❌ Problema

A página `https://leaf.app.br/excluir-conta` está causando loop de redirecionamento infinito:
```
Firefox: "The page isn't redirecting properly"
```

## ✅ Solução Aplicada

### 1. **Simplificação do `_redirects`**
Removidas regras que causavam loop. Agora usa apenas **rewrites** (status 200) que não fazem redirects HTTP.

### 2. **Removida Regra Problemática**
Removido:
```
/excluir-conta.html /excluir-conta.html 200
```
Isso estava causando loop porque redirecionava o arquivo para ele mesmo.

### 3. **Arquivo Atualizado**
O `_redirects` agora contém apenas:
- Rewrites de rotas sem extensão para arquivos `.html`
- Status 200 (serve o arquivo sem redirect HTTP)

---

## 🔧 Arquivos Modificados

1. ✅ `_redirects` - Simplificado, sem loops
2. ✅ `cloudflare-config.json` - Removidos redirects, apenas rewrites
3. ✅ `wrangler.toml` - Configuração alternativa (opcional)

---

## 🚀 Ação Necessária

### Fazer Novo Deploy

```bash
cd landing-page

# Verificar arquivos
ls -la _redirects cloudflare-config.json

# Commit e push
git add _redirects cloudflare-config.json
git commit -m "Fix: Corrigir loop de redirecionamento infinito"
git push origin main
```

---

## 📋 Teste Após Deploy

```bash
# Testar URL
curl -I https://leaf.app.br/excluir-conta

# Deve retornar:
# HTTP/2 200
# Content-Type: text/html

# NÃO deve retornar:
# HTTP/2 301 ou 302 (redirect)
```

---

## ✅ Resultado Esperado

Após o deploy:
- ✅ URL acessível sem loops
- ✅ Página carrega diretamente
- ✅ Sem redirects HTTP
- ✅ Play Store consegue validar

---

**⚠️ IMPORTANTE: O arquivo `_redirects` do Cloudflare Pages usa status 200 para rewrites, que NÃO causam redirects HTTP e não geram loops.**















