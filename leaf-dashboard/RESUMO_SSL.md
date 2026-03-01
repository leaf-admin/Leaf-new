# 🔒 Resumo: SSL para Dashboard

## ✅ O que foi feito

1. **Placeholder do email removido**
   - Alterado de `admin@leaf.com` para `seu@email.com`
   - Deploy realizado

2. **Configuração Nginx criada**
   - Arquivo: `/etc/nginx/sites-available/leaf-dashboard`
   - Proxy reverso configurado para porta 3002
   - Pronto para SSL

## ⚠️ O que falta fazer

### 1. Atualizar DNS

O domínio `dashboard.leaf.app.br` está apontando para o IP errado:

- **IP atual no DNS:** `216.238.107.59` ❌
- **IP correto da VPS:** `147.93.66.253` ✅

**Ação necessária:**
1. Acesse seu provedor de DNS (Cloudflare, Registro.br, etc.)
2. Atualize o registro A:
   ```
   dashboard.leaf.app.br → 147.93.66.253
   ```
3. Aguarde propagação (alguns minutos a algumas horas)

### 2. Verificar DNS

Após atualizar, verifique:

```bash
nslookup dashboard.leaf.app.br
# Deve retornar: 147.93.66.253
```

### 3. Obter Certificado SSL

Após o DNS estar correto, execute na VPS:

```bash
ssh root@147.93.66.253

# Obter certificado SSL
certbot --nginx -d dashboard.leaf.app.br \
  --non-interactive \
  --agree-tos \
  --email suporte@leaf.app.br \
  --redirect
```

## 🔒 Impacto na Configuração

**NÃO vai atrapalhar nada!**

- ✅ Backend continua na porta 3001 (sem mudanças)
- ✅ Dashboard continua na porta 3002 (sem mudanças)
- ✅ App mobile não é afetado
- ✅ Apenas adiciona HTTPS no acesso ao dashboard

### Como funciona

```
Usuário → https://dashboard.leaf.app.br
         ↓ (Nginx com SSL)
         → http://localhost:3002 (Dashboard)
         → http://localhost:3001 (API, quando necessário)
```

O Nginx faz o proxy reverso, então:
- **Externamente:** HTTPS seguro
- **Internamente:** HTTP local (mais rápido, sem overhead SSL)

## 📍 URLs

**Atual (sem SSL):**
- http://147.93.66.253:3002

**Após configurar SSL:**
- https://dashboard.leaf.app.br ✅
- http://dashboard.leaf.app.br → redireciona para HTTPS

## 🚀 Próximos Passos

1. ✅ Placeholder removido
2. ✅ Nginx configurado
3. ⏳ **Atualizar DNS** (você precisa fazer)
4. ⏳ **Obter certificado SSL** (após DNS atualizado)

## 📝 Notas

- Certificado SSL é **gratuito** (Let's Encrypt)
- Renovação **automática** (via cron)
- Válido por **90 dias**


