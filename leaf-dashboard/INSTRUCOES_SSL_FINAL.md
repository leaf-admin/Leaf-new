# 🔒 Instruções Finais: SSL para Dashboard

## ✅ O que já foi feito

1. ✅ **Placeholder do email removido**
   - Alterado de `admin@leaf.com` para `seu@email.com`
   - Deploy realizado na VPS

2. ✅ **Nginx configurado**
   - Arquivo criado: `/etc/nginx/sites-available/leaf-dashboard`
   - Proxy reverso configurado para porta 3002
   - Site habilitado

## ⚠️ O que você precisa fazer

### Passo 1: Atualizar DNS

O domínio `dashboard.leaf.app.br` precisa apontar para o IP correto:

**Situação atual:**
- DNS aponta para: `216.238.107.59` ❌
- IP correto da VPS: `147.93.66.253` ✅

**Ação:**
1. Acesse seu provedor de DNS (onde você gerencia `leaf.app.br`)
2. Atualize o registro A:
   ```
   Tipo: A
   Nome: dashboard
   Valor: 147.93.66.253
   TTL: 300 (ou automático)
   ```
3. Salve e aguarde propagação (5-30 minutos geralmente)

### Passo 2: Verificar DNS

Após alguns minutos, verifique:

```bash
nslookup dashboard.leaf.app.br
# Deve retornar: 147.93.66.253
```

Ou use:
```bash
dig dashboard.leaf.app.br +short
# Deve retornar: 147.93.66.253
```

### Passo 3: Obter Certificado SSL

Após o DNS estar correto, execute na VPS:

```bash
ssh root@147.93.66.253

# Obter certificado SSL (Let's Encrypt)
certbot --nginx -d dashboard.leaf.app.br \
  --non-interactive \
  --agree-tos \
  --email suporte@leaf.app.br \
  --redirect
```

O Certbot vai:
- ✅ Criar certificado SSL automaticamente
- ✅ Atualizar configuração Nginx para HTTPS
- ✅ Configurar redirecionamento HTTP → HTTPS
- ✅ Configurar renovação automática

## 🔒 Impacto na Configuração

**NÃO vai atrapalhar nada!**

### Como funciona:

```
┌─────────────────┐
│  Usuário       │
│  (Navegador)      │
└────────┬────────┘
         │ HTTPS
         ↓
┌─────────────────┐
│  Nginx          │ ← SSL/TLS aqui (porta 443)
│  (Proxy)        │
└────────┬────────┘
         │ HTTP local
         ↓
┌─────────────────┐
│  Dashboard      │ ← Sem mudanças (porta 3002)
│  (Next.js)      │
└─────────────────┘
```

### O que NÃO muda:

- ✅ Backend API continua em `http://147.93.66.253:3001`
- ✅ Dashboard continua em `http://localhost:3002` (interno)
- ✅ App mobile não é afetado
- ✅ WebSocket funciona normalmente
- ✅ Todas as configurações existentes continuam funcionando

### O que muda:

- ✅ Acesso externo passa a ser HTTPS
- ✅ Certificado SSL válido (sem aviso de "não seguro")
- ✅ Redirecionamento automático HTTP → HTTPS

## 📍 URLs

**Atual (sem SSL):**
- http://147.93.66.253:3002

**Após configurar SSL:**
- https://dashboard.leaf.app.br ✅ (principal)
- http://dashboard.leaf.app.br → redireciona para HTTPS

## 🔧 Configuração do Dashboard (Opcional)

Se quiser que o dashboard use HTTPS nas chamadas de API (opcional):

```javascript
// src/config/index.js
baseUrl: process.env.NEXT_PUBLIC_API_URL || 'https://dashboard.leaf.app.br/api'
```

**Mas isso é opcional!** O Nginx já faz o proxy corretamente, então pode continuar usando `http://147.93.66.253:3001` internamente.

## 🐛 Troubleshooting

### Erro: "Domain doesn't point to this server"
- Verifique DNS: `nslookup dashboard.leaf.app.br`
- Aguarde mais tempo para propagação

### Erro: "Certificate already exists"
- O certificado já existe, apenas recarregue:
  ```bash
  systemctl reload nginx
  ```

### Dashboard não carrega após SSL
- Verifique PM2: `pm2 status leaf-dashboard`
- Verifique Nginx: `systemctl status nginx`
- Verifique logs: `pm2 logs leaf-dashboard`

## 📝 Resumo

1. ✅ Placeholder removido
2. ✅ Nginx configurado
3. ⏳ **Você precisa:** Atualizar DNS
4. ⏳ **Depois:** Executar `certbot --nginx -d dashboard.leaf.app.br`

**Tempo estimado:** 10-15 minutos (após atualizar DNS)


