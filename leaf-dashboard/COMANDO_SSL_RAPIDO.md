# 🔒 Comando Rápido para SSL

## ⚠️ PRIMEIRO: Atualizar DNS no Cloudflare

1. Acesse: https://dash.cloudflare.com/
2. Selecione: `leaf.app.br`
3. Vá em: **DNS → Records**
4. Adicione/Atualize:
   - **Type:** `A`
   - **Name:** `dashboard`
   - **Content:** `147.93.66.253`
   - **Proxy:** 🟢 OFF (cinza)
5. Salve e aguarde 5 minutos

## ✅ DEPOIS: Executar na VPS

```bash
ssh root@147.93.66.253

certbot --nginx -d dashboard.leaf.app.br \
  --non-interactive \
  --agree-tos \
  --email suporte@leaf.app.br \
  --redirect
```

## 🎉 Pronto!

Acesse: **https://dashboard.leaf.app.br**


