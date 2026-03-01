# 🚀 Deploy Rápido do Dashboard na VPS

## ✅ **VANTAGENS**

- ✅ **Sem problemas de compilação** - Build feito localmente
- ✅ **Muito mais rápido** - Produção otimizada
- ✅ **Estável** - Sem erros de desenvolvimento
- ✅ **PM2** - Reinicia automaticamente se cair
- ✅ **Nginx** - Pode servir estático ou via proxy

---

## 🚀 **DEPLOY EM 1 COMANDO**

```bash
cd leaf-dashboard
./deploy-vps.sh
```

O script irá:
1. ✅ Fazer build de produção localmente
2. ✅ Enviar arquivos para VPS
3. ✅ Instalar dependências na VPS
4. ✅ Iniciar com PM2
5. ✅ Dashboard rodando em `http://147.93.66.253:3002`

---

## 📋 **DEPLOY MANUAL (SE PRECISAR)**

### 1. Build Local

```bash
cd leaf-dashboard
rm -rf .next
npm run build
```

### 2. Enviar para VPS

```bash
# Usar sshpass ou configurar SSH key
sshpass -p "S-s'GZhsuMu3EI;-7ed1" rsync -avz \
  --exclude 'node_modules' \
  --exclude '.git' \
  .next/ root@147.93.66.253:/opt/leaf-dashboard/.next/

sshpass -p "S-s'GZhsuMu3EI;-7ed1" scp package.json root@147.93.66.253:/opt/leaf-dashboard/
```

### 3. Na VPS

```bash
ssh root@147.93.66.253
cd /opt/leaf-dashboard
npm install --production
pm2 start npm --name "leaf-dashboard" -- start
pm2 save
```

---

## 🔧 **CONFIGURAR NGINX (OPCIONAL)**

Para servir via `http://147.93.66.253/dashboard`:

```nginx
location /dashboard {
    proxy_pass http://localhost:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
}
```

---

## 🧪 **VERIFICAR**

```bash
# Ver logs
ssh root@147.93.66.253 "pm2 logs leaf-dashboard"

# Ver status
ssh root@147.93.66.253 "pm2 status"

# Testar
curl http://147.93.66.253:3002
```

---

## ✅ **VANTAGENS DO BUILD DE PRODUÇÃO**

- ⚡ **10x mais rápido** que dev mode
- 🛡️ **Sem erros de compilação** em runtime
- 📦 **Otimizado** - código minificado
- 🔒 **Mais seguro** - sem source maps em produção
- 🚀 **Pronto para produção**

---

**Última atualização:** 21/12/2025


