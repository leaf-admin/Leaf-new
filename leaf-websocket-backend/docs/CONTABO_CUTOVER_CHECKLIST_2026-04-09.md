# Contabo Runtime DNS Checklist

## Endpoints canônicos

O runtime atual deve operar pelos domínios Leaf:

- `https://api.leaf.app.br`
- `https://socket.leaf.app.br`
- `https://dashboard.leaf.app.br`

## Proxy

O proxy da Contabo deve responder por:

- `api.leaf.app.br`
- `socket.leaf.app.br`
- `dashboard.leaf.app.br`
- servir `/.well-known/acme-challenge/` para o Let's Encrypt

Arquivos:

- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/nginx.conf`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/docker-compose.production.yml`

## TLS

Rode na VPS:

```bash
cd /opt/leaf-app
bash scripts/ops/issue-contabo-letsencrypt.sh <seu-email>
```

## Backend

Depois do TLS, alinhar estas variáveis do runtime:

- `SERVER_URL=https://api.leaf.app.br`
- `WOOVI_WEBHOOK_URL=https://api.leaf.app.br/api/woovi/webhook`
- `CORS_ORIGIN=https://dashboard.leaf.app.br`

## Clientes

Os defaults canônicos do stack ativo já foram atualizados para os domínios reais:

- mobile:
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/ApiConfig.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/WebSocketConfig.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/NetworkConfig.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/config/backendBaseUrl.js`
  - `/Users/izaakdias/Documents/Leaf-new/mobile-app/src/services/SyncService.js`
- dashboard:
  - `/Users/izaakdias/Documents/Leaf-new/leaf-dashboard-js/src/config/index.js`

## Smoke

Depois do cutover:

1. `curl https://api.leaf.app.br/health`
2. smoke de corrida normal
3. smoke de lifecycle
4. smoke de reatribuição operacional
