# 🚀 Guia Rápido de Deploy - Cloudflare Pages

## 📋 Duas Opções de Deploy

### ✅ Opção 1: Upload Manual (Mais Rápido)

**Passo a passo:**

1. **Acesse o Cloudflare Dashboard**
   - Vá em: https://dash.cloudflare.com/
   - Faça login

2. **Vá em Pages**
   - Menu lateral → **Pages**
   - Se já tiver projeto: clique nele
   - Se não tiver: clique em **"Create a project"**

3. **Upload dos Arquivos**
   - Se já tem projeto: vá em **Settings** → **Deployments** → **Retry deployment**
   - Ou clique em **"Upload assets"** (se disponível)
   - Faça upload da pasta `landing-page` completa

4. **Arquivos Importantes para Upload:**
   ```
   ✅ index.html
   ✅ privacy-policy.html
   ✅ terms-of-service.html
   ✅ assets/ (pasta completa)
   ✅ _headers (se existir)
   ✅ _redirects (se existir)
   ```

5. **Aguarde o Deploy**
   - Cloudflare vai processar (1-2 minutos)
   - Você verá a URL do projeto

---

### ✅ Opção 2: Via Git (Automático - Recomendado)

**Se seu projeto já está conectado ao Git:**

```bash
cd landing-page
git add privacy-policy.html terms-of-service.html
git commit -m "Adiciona termos de uso e atualiza política de privacidade"
git push origin main
```

**O Cloudflare vai fazer deploy automaticamente!** 🎉

---

## 🔍 Verificar URLs Após Deploy

Após o deploy, teste se as páginas estão acessíveis:

1. **Descubra sua URL:**
   - No Cloudflare Pages → Seu projeto
   - Veja a **Production URL** (ex: `https://seu-projeto.pages.dev`)
   - Ou veja **Custom domains** se configurado (ex: `https://leaf.app.br`)

2. **Teste as URLs:**
   - `https://SUA-URL/privacy-policy.html`
   - `https://SUA-URL/terms-of-service.html`

3. **Se não abrir:**
   - Verifique se os arquivos foram incluídos no upload
   - Aguarde alguns minutos (pode levar tempo para propagar)

---

## ⚠️ IMPORTANTE: Atualizar AppConfig.js

Depois de confirmar que as URLs estão funcionando:

1. **Anote a URL correta** do seu Cloudflare Pages

2. **Atualize o AppConfig.js:**
   ```javascript
   // mobile-app/config/AppConfig.js
   privacy_policy_url: 'https://SUA-URL-AQUI/privacy-policy.html',
   terms_of_service_url: 'https://SUA-URL-AQUI/terms-of-service.html',
   ```

3. **Exemplo:**
   - Se sua URL é `https://leaf.app.br`:
     ```javascript
     privacy_policy_url: 'https://leaf.app.br/privacy-policy.html',
     terms_of_service_url: 'https://leaf.app.br/terms-of-service.html',
     ```
   
   - Se sua URL é `https://leaf-landing.pages.dev`:
     ```javascript
     privacy_policy_url: 'https://leaf-landing.pages.dev/privacy-policy.html',
     terms_of_service_url: 'https://leaf-landing.pages.dev/terms-of-service.html',
     ```

---

## 🆘 Problemas Comuns

### Página 404 ao acessar
- **Solução:** Verifique se o arquivo foi incluído no upload
- Certifique-se que o nome do arquivo está correto (com hífen, não underscore)

### Estilos não aparecem
- **Solução:** Verifique se a pasta `assets/` foi incluída no upload

### Link não funciona
- **Solução:** Use caminho relativo: `privacy-policy.html` (sem `/` no início)

---

## ✅ Checklist Final

Antes de submeter o app nas lojas:

- [ ] Deploy feito no Cloudflare Pages
- [ ] URLs testadas e funcionando
- [ ] `privacy-policy.html` acessível
- [ ] `terms-of-service.html` acessível
- [ ] `AppConfig.js` atualizado com URLs corretas
- [ ] Testado em navegador (abrir as URLs)

---

**Pronto!** Com isso, suas páginas legais estarão públicas e prontas para uso nas lojas! 🎉

