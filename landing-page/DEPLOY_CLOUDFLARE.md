# 🚀 Deploy da Landing Page Leaf no Cloudflare

## 📋 Pré-requisitos

1. Conta no Cloudflare (domínio já configurado)
2. Node.js instalado (se usar build local)
3. Git configurado

---

## 🎯 Opção 1: Cloudflare Pages (Recomendado - Mais Fácil)

### Passo 1: Preparar arquivos
```bash
cd landing-page

# Copiar arquivos necessários
cp index.html .
cp em-breve.html .

# Garantir que assets estão no lugar
ls assets/
```

### Passo 2: Criar projeto no Cloudflare Pages

1. Acesse: https://dash.cloudflare.com/
2. Menu lateral → **Pages**
3. Clique em **Create a project**
4. Conecte seu repositório Git (GitHub/GitLab/Bitbucket)
5. Configure:
   - **Project name**: `leaf-landing` (ou o nome que preferir)
   - **Production branch**: `main` (ou `master`)
   - **Build command**: (deixe vazio - site estático)
   - **Build output directory**: `/landing-page`
   - **Root directory**: `/landing-page`

### Passo 3: Variáveis de Ambiente (Opcional)
Se quiser usar variáveis:
- Settings → Environment variables
- Adicionar: `NODE_ENV=production`

### Passo 4: Configurar domínio
1. Project settings → Custom domains
2. Adicione o domínio desejado (ex: `leafapp.com` ou `www.leafapp.com`)

### Passo 5: Deploy automático
- Toda vez que você fizer push para o branch configurado, o deploy acontece automaticamente
- Cloudflare vai mostrar a URL do projeto: `leaf-landing.pages.dev`

---

## 🎯 Opção 2: Deploy Manual via Cloudflare Pages (Sem Git)

### Passo 1: Preparar arquivos
```bash
cd landing-page

# Criar diretório temporário
mkdir -p ../temp-deploy
cp -r . ../temp-deploy/
cd ../temp-deploy

# Limpar arquivos desnecessários
rm -rf index-novo.html index-old.html

# Criar .gitignore se necessário
echo "*.old
index-novo.html" > .gitignore
```

### Passo 2: Upload direto no Cloudflare
1. Acesse: https://dash.cloudflare.com/
2. Menu lateral → **Pages**
3. Clique em **Create a project**
4. Escolha **Upload assets**
5. Faça upload da pasta `temp-deploy`
6. Defina o nome do projeto
7. Clique em **Deploy site**

---

## 🎯 Opção 3: Deploy via VPS (Controle Total)

### Passo 1: Preparar servidor
```bash
# Instalar nginx
sudo apt update
sudo apt install nginx -y

# Criar diretório para a landing page
sudo mkdir -p /var/www/leaf-landing
sudo chown -R $USER:$USER /var/www/leaf-landing
```

### Passo 2: Copiar arquivos
```bash
# Na sua máquina local
cd landing-page

# Compactar
tar -czf leaf-landing.tar.gz *.html assets/

# Transferir para VPS
scp leaf-landing.tar.gz user@your-vps:/var/www/leaf-landing/
```

### Passo 3: Extrair e configurar no VPS
```bash
# SSH no VPS
ssh user@your-vps

# Ir para o diretório
cd /var/www/leaf-landing/

# Extrair
tar -xzf leaf-landing.tar.gz

# Limpar
rm leaf-landing.tar.gz
```

### Passo 4: Configurar Nginx
```bash
sudo nano /etc/nginx/sites-available/leaf-landing
```

Conteúdo:
```nginx
server {
    listen 80;
    listen [::]:80;
    
    server_name yourdomain.com www.yourdomain.com;
    
    root /var/www/leaf-landing;
    index index.html;
    
    location / {
        try_files $uri $uri/ =404;
    }
    
    # Cache para assets
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # Gzip
    gzip on;
    gzip_types text/html text/css application/javascript application/json;
}
```

### Passo 5: Ativar site
```bash
# Criar link simbólico
sudo ln -s /etc/nginx/sites-available/leaf-landing /etc/nginx/sites-enabled/

# Testar configuração
sudo nginx -t

# Reiniciar nginx
sudo systemctl restart nginx
```

### Passo 6: Configurar SSL (Let's Encrypt)
```bash
# Instalar certbot
sudo apt install certbot python3-certbot-nginx -y

# Obter certificado SSL
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Renovação automática
sudo certbot renew --dry-run
```

---

## 🔧 Configuração de DNS na Cloudflare

### Para usar com domínio existente:

1. Acesse: https://dash.cloudflare.com/
2. Selecione seu domínio
3. Vá em **DNS → Records**
4. Configure:

**Opção A - Cloudflare Pages:**
```
Type: CNAME
Name: (vazio ou www)
Target: leaf-landing.pages.dev
Proxy: ON (laranja)
```

**Opção B - VPS:**
```
Type: A
Name: (vazio)
Target: IP_DO_SEU_VPS
Proxy: ON (laranja)
```

---

## 🚀 Checklist antes do Deploy

- [x] Arquivo `index.html` atualizado e funcionando
- [x] Arquivo `em-breve.html` criado
- [x] Todos os assets presentes em `assets/`
- [x] Logo configurado (`assets/logo-leaf.jpg`)
- [x] Testado localmente
- [x] Formulário testado
- [x] Modal de sucesso funcionando
- [x] Cálculo de ganhos funcionando

---

## 📱 URLs após Deploy

**Cloudflare Pages:**
- Produção: `https://your-domain.com`
- Preview: `https://leaf-landing.pages.dev`

**VPS:**
- Produção: `https://your-domain.com`

---

## 🔄 Deploy Contínuo (Automatizado)

### Cloudflare Pages + GitHub Actions

Criar `.github/workflows/deploy.yml`:
```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches:
      - main
    paths:
      - 'landing-page/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: leaf-landing
          directory: landing-page
```

---

## 🆘 Troubleshooting

### Problema: CSS não carrega
**Solução:** Verificar caminhos dos arquivos CSS/JS

### Problema: Imagens não aparecem
**Solução:** Verificar se caminho de `assets/` está correto

### Problema: Formulário não envia
**Solução:** Verificar URL da API no código JavaScript

### Problema: 404 em rotas
**Solução:** Configurar `_redirects` ou ajustar nginx

---

## ✅ Próximos Passos

1. Configurar Google Analytics
2. Adicionar meta tags SEO
3. Configurar sitemap.xml
4. Configurar robots.txt
5. Habilitar HTTPS/SSL
6. Configurar cache de imagens

---

**🎉 Pronto! Sua landing page está no ar!**


