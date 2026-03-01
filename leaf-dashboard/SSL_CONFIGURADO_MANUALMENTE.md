# ✅ SSL Configurado Manualmente

## Status Atual

- ✅ **Certificado SSL criado:** `/etc/letsencrypt/live/dashboard.leaf.app.br/`
- ✅ **Dashboard HTTP funcionando:** `http://dashboard.leaf.app.br`
- ⚠️ **HTTPS ainda não configurado no Nginx**

## Próximo Passo

O certificado SSL foi criado com sucesso, mas a configuração HTTPS no Nginx precisa ser adicionada manualmente ao arquivo `/opt/leaf-app/nginx.conf` dentro do bloco `http`, antes do fechamento.

### Configuração HTTPS necessária:

```nginx
server {
    listen 443 ssl http2;
    server_name dashboard.leaf.app.br;
    
    ssl_certificate /etc/letsencrypt/live/dashboard.leaf.app.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dashboard.leaf.app.br/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    
    location / {
        proxy_pass http://dashboard_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
    
    location /api/ {
        proxy_pass http://leaf_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /socket.io/ {
        proxy_pass http://leaf_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### E adicionar redirecionamento HTTP->HTTPS no bloco HTTP:

```nginx
server {
    listen 80;
    server_name dashboard.leaf.app.br;
    return 301 https://$server_name$request_uri;
}
```

## Acesso Atual

- **HTTP:** http://dashboard.leaf.app.br ✅ Funcionando
- **HTTPS:** https://dashboard.leaf.app.br ⚠️ Aguardando configuração manual


