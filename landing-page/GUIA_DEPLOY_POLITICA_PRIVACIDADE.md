# 📋 Guia: Como Publicar a Política de Privacidade no Cloudflare

## ✅ O que foi feito:

1. ✅ Criado arquivo `privacy-policy.html` na pasta `landing-page/`
2. ✅ Link atualizado no footer do `index.html` apontando para `privacy-policy.html`
3. ✅ Página estilizada e responsiva criada

---

## 🚀 Como fazer o Deploy no Cloudflare:

### **Opção 1: Cloudflare Pages (Recomendado - Mais Fácil)**

#### Passo 1: Acessar Cloudflare Dashboard
1. Acesse: https://dash.cloudflare.com/
2. Faça login na sua conta

#### Passo 2: Criar/Acessar Projeto Pages
1. No menu lateral, clique em **"Pages"**
2. Se já tiver um projeto:
   - Clique no projeto existente
   - Vá em **"Settings"** → **"Deployments"**
   - Clique em **"Retry deployment"** ou faça um novo push no Git
3. Se não tiver projeto:
   - Clique em **"Create a project"**
   - Escolha **"Connect to Git"** (GitHub/GitLab/Bitbucket)
   - Ou escolha **"Upload assets"** para upload manual

#### Passo 3: Configurar Projeto (se novo)
- **Project name**: `leaf-landing`
- **Production branch**: `main` (ou `master`)
- **Build command**: (deixe vazio - site estático)
- **Build output directory**: `/landing-page`
- **Root directory**: `/landing-page`

#### Passo 4: Fazer Push/Upload
**Se conectou Git:**
```bash
git add landing-page/privacy-policy.html landing-page/index.html
git commit -m "Adiciona política de privacidade"
git push origin main
```
O Cloudflare vai fazer o deploy automaticamente! 🎉

**Se escolheu Upload Manual:**
1. Use o script preparado:
```bash
cd landing-page
bash deploy-to-cloudflare.sh
# Escolha opção 2
```
2. Vá no Cloudflare Pages → Upload assets
3. Faça upload da pasta `temp-deploy-leaf`

---

### **Opção 2: Deploy Manual Rápido**

#### Passo 1: Preparar arquivos
```bash
cd landing-page

# Criar package
tar -czf leaf-landing-complete.tar.gz \
    index.html \
    em-breve.html \
    privacy-policy.html \
    assets/
```

#### Passo 2: Upload no Cloudflare
1. Acesse: https://dash.cloudflare.com/
2. Menu lateral → **Pages**
3. Selecione seu projeto (ou crie um novo)
4. Clique em **"Upload assets"**
5. Faça upload do arquivo `.tar.gz` ou da pasta com os arquivos

---

## 🌐 Configurar Domínio Personalizado (Opcional)

### Passo 1: Adicionar domínio
1. No projeto Pages → **Settings** → **Custom domains**
2. Clique em **"Add a custom domain"**
3. Digite seu domínio (ex: `leafapp.com` ou `www.leafapp.com`)
4. Cloudflare vai configurar automaticamente

### Passo 2: Configurar DNS (se necessário)
1. Vá em **DNS → Records**
2. Adicione registro:
   - **Type**: `CNAME`
   - **Name**: `@` ou `www`
   - **Target**: `seu-projeto.pages.dev`
   - **Proxy**: ON (laranja)

---

## ✅ Verificar se está funcionando:

Após o deploy, verifique:
1. Acesse a URL do seu site (ex: `seu-projeto.pages.dev` ou seu domínio)
2. Role até o footer
3. Clique no link **"Política de Privacidade"**
4. Deve abrir a página `privacy-policy.html`

**URL esperada:** `https://seu-dominio.com/privacy-policy.html`

---

## 📝 Checklist de Deploy:

- [x] Arquivo `privacy-policy.html` criado
- [x] Link atualizado no footer do `index.html`
- [ ] Arquivos enviados para Cloudflare (Git push ou Upload)
- [ ] Deploy completo e funcionando
- [ ] Link testado no site ao vivo
- [ ] Domínio personalizado configurado (se necessário)

---

## 🔗 Links Importantes:

- **Cloudflare Dashboard**: https://dash.cloudflare.com/
- **Cloudflare Pages**: https://dash.cloudflare.com/?to=/:account/pages
- **Documentação Cloudflare Pages**: https://developers.cloudflare.com/pages/

---

## 🆘 Troubleshooting:

### Problema: Página 404 ao acessar `/privacy-policy.html`
**Solução:** Verifique se o arquivo foi incluído no upload/deploy

### Problema: Link não funciona
**Solução:** Verifique o caminho no `index.html` - deve ser `privacy-policy.html` (sem `/` no início)

### Problema: Estilos não aparecem
**Solução:** Verifique se a pasta `assets/` foi incluída no deploy

---

**🎉 Pronto! Sua política de privacidade está no ar!**















