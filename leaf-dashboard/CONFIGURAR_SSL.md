# 🔒 Configurar SSL para o Dashboard

## ⚠️ Situação Atual

- **Domínio:** `dashboard.leaf.app.br`
- **IP atual no DNS:** `216.238.107.59` ❌
- **IP da VPS atual:** `147.93.66.253` ✅

## 📋 Passos para Configurar SSL

### 1️⃣ Atualizar DNS

O domínio `dashboard.leaf.app.br` precisa apontar para o IP da VPS atual:

```
dashboard.leaf.app.br → 147.93.66.253 (A record)
```

**Onde configurar:**
- Cloudflare (se usar)
- Registro.br (se for .br)
- Seu provedor de DNS

### 2️⃣ Aguardar Propagação

Após atualizar o DNS, aguarde alguns minutos para propagação.

**Verificar:**
```bash
nslookup dashboard.leaf.app.br
# Deve retornar: 147.93.66.253
```

### 3️⃣ Configurar SSL na VPS

Após o DNS estar correto, execute na VPS:

```bash
ssh root@147.93.66.253

# Instalar Certbot (se não tiver)
apt-get update
apt-get install -y certbot python3-certbot-nginx

# Obter certificado SSL
certbot --nginx -d dashboard.leaf.app.br --non-interactive --agree-tos --email suporte@leaf.app.br --redirect
```

### 4️⃣ Verificar Configuração

O Certbot vai:
- ✅ Criar certificado SSL automaticamente
- ✅ Configurar Nginx para HTTPS
- ✅ Redirecionar HTTP → HTTPS
- ✅ Renovar automaticamente (via cron)

## 🔧 Configuração Manual (se necessário)

Se o Certbot não funcionar, você pode configurar manualmente:

```bash
# Na VPS
cat > /etc/nginx/sites-available/leaf-dashboard << 'EOF'
server {
    listen 80;
    server_name dashboard.leaf.app.br;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name dashboard.leaf.app.br;
    
    ssl_certificate /etc/letsencrypt/live/dashboard.leaf.app.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dashboard.leaf.app.br/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/leaf-dashboard /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## ✅ Impacto na Configuração Geral

**NÃO vai atrapalhar nada!** 

O SSL:
- ✅ Funciona como **reverse proxy** (Nginx → Dashboard)
- ✅ **Não altera** as configurações do backend (porta 3001)
- ✅ **Não altera** as configurações do dashboard (porta 3002)
- ✅ **Não altera** as configurações do app mobile
- ✅ Apenas adiciona uma camada de segurança HTTP → HTTPS

### URLs Após SSL

- **Dashboard:** `https://dashboard.leaf.app.br` ✅
- **Backend API:** Continua em `http://147.93.66.253:3001` (ou pode ter SSL também)
- **WebSocket:** Funciona normalmente através do proxy

## 🔄 Atualizar Configurações do Dashboard (se necessário)

Se você quiser que o dashboard use HTTPS nas chamadas de API, atualize:

```javascript
// src/config/index.js
baseUrl: process.env.NEXT_PUBLIC_API_URL || 'https://dashboard.leaf.app.br/api'
```

Mas isso é **opcional** - o Nginx já faz o proxy corretamente.

## 🐛 Troubleshooting

### Erro: "Domain doesn't point to this server"
- Verifique se o DNS está correto: `nslookup dashboard.leaf.app.br`
- Aguarde propagação (pode levar até 24h, geralmente alguns minutos)

### Erro: "Certificate already exists"
- O certificado já foi criado, apenas recarregue o Nginx

### Dashboard não carrega após SSL
- Verifique se o PM2 está rodando: `pm2 status leaf-dashboard`
- Verifique logs: `pm2 logs leaf-dashboard`
- Verifique Nginx: `nginx -t && systemctl status nginx`

## 📝 Notas

- O certificado SSL é **gratuito** (Let's Encrypt)
- Renovação **automática** (via cron do Certbot)
- Válido por **90 dias**, renovado automaticamente


