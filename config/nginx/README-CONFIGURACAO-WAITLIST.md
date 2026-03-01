# 🍃 Configuração Nginx para Waitlist API

## 📋 Problema

A landing page está hospedada na **Cloudflare** (servidor estático), mas precisa fazer requisições para o backend Node.js que está no servidor VPS. O erro 405 ocorre porque a Cloudflare não consegue rotear `/api/*` para o backend.

## ✅ Solução

Configurar o nginx no servidor para rotear `/api/*` para o backend Node.js na porta 3001.

## 🚀 Como Aplicar

### Opção 1: Script Automático (Recomendado)

```bash
cd /home/izaak-dias/Downloads/1.\ leaf/main/Sourcecode
sudo bash scripts/maintenance/configure-nginx-waitlist.sh
```

### Opção 2: Manual

1. **Copiar arquivo de configuração:**
```bash
sudo cp config/nginx/nginx-leaf-app-br.conf /etc/nginx/sites-available/leaf-app-br
```

2. **Criar link simbólico:**
```bash
sudo ln -s /etc/nginx/sites-available/leaf-app-br /etc/nginx/sites-enabled/leaf-app-br
```

3. **Testar configuração:**
```bash
sudo nginx -t
```

4. **Recarregar nginx:**
```bash
sudo systemctl reload nginx
```

## 🔍 Verificação

### 1. Verificar se o backend está rodando:
```bash
pm2 list
# ou
netstat -tuln | grep 3001
```

### 2. Testar endpoint diretamente:
```bash
curl -X POST https://leaf.app.br/api/waitlist/landing \
  -H "Content-Type: application/json" \
  -d '{"nome":"Teste","celular":"11999999999","cidade":"São Paulo"}'
```

### 3. Verificar logs do nginx:
```bash
tail -f /var/log/nginx/leaf-app-br-error.log
tail -f /var/log/nginx/leaf-app-br-access.log
```

## 📝 O que a configuração faz

1. **Roteia `/api/*`** → `http://127.0.0.1:3001` (backend Node.js)
2. **Roteia `/socket.io/*`** → `http://127.0.0.1:3001` (WebSocket)
3. **Configura CORS** para permitir requisições de `https://leaf.app.br`
4. **Trata requisições OPTIONS** (preflight CORS)

## ⚠️ Importante

- Certifique-se de que o **certificado SSL** está configurado em `/etc/letsencrypt/live/leaf.app.br/`
- O backend Node.js deve estar rodando na **porta 3001**
- A configuração assume que o backend está em `127.0.0.1:3001`

## 🔧 Troubleshooting

### Erro: "502 Bad Gateway"
- Verifique se o backend está rodando: `pm2 list`
- Verifique se a porta 3001 está aberta: `netstat -tuln | grep 3001`

### Erro: "405 Method Not Allowed"
- Verifique se a rota `/api/waitlist/landing` está registrada no backend
- Verifique os logs do nginx: `tail -f /var/log/nginx/leaf-app-br-error.log`

### Erro de CORS
- Verifique se o header `Access-Control-Allow-Origin` está sendo enviado
- Verifique se a origem da requisição é `https://leaf.app.br`

## 📚 Arquivos Relacionados

- **Configuração Nginx:** `config/nginx/nginx-leaf-app-br.conf`
- **Script de instalação:** `scripts/maintenance/configure-nginx-waitlist.sh`
- **Backend Waitlist:** `leaf-websocket-backend/routes/waitlist.js`
- **Landing Page:** `landing-page/index.html`






















