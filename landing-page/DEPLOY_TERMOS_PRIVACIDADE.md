# 🚀 Deploy das Páginas Legais no Cloudflare Pages

## ✅ Arquivos Criados

1. ✅ `privacy-policy.html` - Já existia
2. ✅ `terms-of-service.html` - **CRIADO AGORA**

## 📋 Passos para Deploy

### Opção 1: Deploy Automático (se conectado ao Git)

```bash
cd landing-page
git add privacy-policy.html terms-of-service.html
git commit -m "Adiciona termos de uso e atualiza política de privacidade"
git push origin main
```

O Cloudflare Pages vai fazer o deploy automaticamente! 🎉

### Opção 2: Deploy Manual

1. Acesse: https://dash.cloudflare.com/
2. Vá em **Pages** → Seu projeto
3. Clique em **Upload assets** ou **Retry deployment**
4. Faça upload dos arquivos:
   - `privacy-policy.html`
   - `terms-of-service.html`
   - Todos os outros arquivos da pasta `landing-page/`

## ✅ Verificar URLs Após Deploy

Após o deploy, teste se as URLs estão acessíveis:

1. **Política de Privacidade:**
   - `https://leaf.app.br/privacy-policy.html`
   - (ou `https://seu-projeto.pages.dev/privacy-policy.html`)

2. **Termos de Uso:**
   - `https://leaf.app.br/terms-of-service.html`
   - (ou `https://seu-projeto.pages.dev/terms-of-service.html`)

## ⚠️ IMPORTANTE

**Antes de submeter o app nas lojas, você DEVE:**

1. ✅ Confirmar qual é a URL correta do seu Cloudflare Pages
2. ✅ Testar se as páginas abrem corretamente
3. ✅ Atualizar `AppConfig.js` se a URL for diferente de `leaf.app.br`
4. ✅ Garantir que as URLs estão públicas e acessíveis

## 🔍 Como Descobrir a URL do Cloudflare Pages

1. Acesse: https://dash.cloudflare.com/
2. Vá em **Pages** → Seu projeto
3. Na página do projeto, você verá:
   - **Production URL**: `https://seu-projeto.pages.dev`
   - **Custom domains**: Se configurado, mostrará o domínio personalizado

Use a URL que estiver configurada como **Production URL** ou **Custom domain**.

## 📝 Atualizar AppConfig.js

Se a URL for diferente de `leaf.app.br`, atualize o arquivo:

```javascript
// mobile-app/config/AppConfig.js
privacy_policy_url: 'https://SUA-URL-AQUI/privacy-policy.html',
terms_of_service_url: 'https://SUA-URL-AQUI/terms-of-service.html',
```

---

**Pronto!** Após o deploy, as páginas estarão acessíveis e você poderá usar as URLs no `AppConfig.js` para publicação nas lojas.

