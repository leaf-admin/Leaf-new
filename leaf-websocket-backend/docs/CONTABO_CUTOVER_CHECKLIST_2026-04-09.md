# Contabo Cutover Checklist

## Endpoints temporários

Enquanto o domínio real não estiver regularizado, os hosts provisórios são:

- `https://api.62.169.31.231.sslip.io`
- `https://socket.62.169.31.231.sslip.io`
- `https://dashboard.62.169.31.231.sslip.io`
- `https://62.169.31.231.sslip.io`

## Proxy

O proxy da Contabo já está preparado para:

- responder por `api.62.169.31.231.sslip.io`
- responder por `socket.62.169.31.231.sslip.io`
- responder por `dashboard.62.169.31.231.sslip.io`
- responder por `62.169.31.231.sslip.io`
- servir `/.well-known/acme-challenge/` para o Let's Encrypt

Arquivos:

- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/nginx.conf`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/docker-compose.hostinger.yml`

## TLS

Os hosts `sslip` já resolvem. Rode na VPS:

```bash
cd /opt/leaf-app
bash scripts/ops/issue-contabo-letsencrypt.sh <seu-email>
```

## Backend

Depois do TLS, alinhar estas variáveis do runtime:

- `SERVER_URL=https://api.62.169.31.231.sslip.io`
- `WOOVI_WEBHOOK_URL=https://api.62.169.31.231.sslip.io/api/woovi/webhook`
- `CORS_ORIGIN=https://dashboard.62.169.31.231.sslip.io,https://62.169.31.231.sslip.io`

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

1. `curl https://api.62.169.31.231.sslip.io/health`
2. smoke de corrida normal
3. smoke de lifecycle
4. smoke de reatribuição operacional
