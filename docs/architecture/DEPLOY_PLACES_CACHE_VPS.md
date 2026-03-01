# 🚀 Deploy Places Cache na VPS

## ⚠️ Status Atual

Os endpoints de Places Cache **ainda não estão disponíveis na VPS** porque:
- Código novo ainda não foi deployado
- Servidor precisa ser reiniciado após deploy

---

## 📋 Passos para Deploy

### **Opção 1: Deploy Manual (Recomendado)**

#### 1. **Fazer backup do servidor atual**
```bash
# Na VPS
cd /path/to/leaf-websocket-backend
cp server.js server.js.backup
```

#### 2. **Enviar arquivos novos para VPS**
```bash
# No seu PC local
scp leaf-websocket-backend/services/places-cache-service.js user@216.238.107.59:/path/to/leaf-websocket-backend/services/
scp leaf-websocket-backend/routes/places-routes.js user@216.238.107.59:/path/to/leaf-websocket-backend/routes/
scp leaf-websocket-backend/utils/places-normalizer.js user@216.238.107.59:/path/to/leaf-websocket-backend/utils/
scp leaf-websocket-backend/server.js user@216.238.107.59:/path/to/leaf-websocket-backend/
```

#### 3. **Instalar dependências (se necessário)**
```bash
# Na VPS
cd /path/to/leaf-websocket-backend
npm install
```

#### 4. **Reiniciar servidor**
```bash
# Na VPS
pm2 restart leaf-websocket-backend
# ou
systemctl restart leaf-backend
# ou
node server.js (se rodando diretamente)
```

---

### **Opção 2: Deploy via Git (Se usar Git)**

```bash
# Na VPS
cd /path/to/leaf-websocket-backend
git pull origin main
npm install
pm2 restart leaf-websocket-backend
```

---

## ✅ Verificação Pós-Deploy

### **1. Verificar se endpoints estão disponíveis:**
```bash
curl http://216.238.107.59:3001/api/places/health
curl http://216.238.107.59:3001/api/places/metrics
```

### **2. Verificar logs do servidor:**
```bash
# Se usar PM2
pm2 logs leaf-websocket-backend

# Procurar por:
# ✅ Rotas de Places Cache registradas
# ✅ Places Cache Service inicializado
```

### **3. Verificar se feature flag está habilitada:**
```bash
# Na VPS, verificar variável de ambiente
echo $ENABLE_PLACES_CACHE
# Deve estar vazio ou "true" (não "false")
```

---

## 🔧 Configuração do Dashboard

### **Atualizar URL da API no Dashboard:**

O dashboard está configurado para `localhost:3001`. Para usar a VPS:

#### **Opção 1: Variável de Ambiente**
```bash
# No dashboard
export NEXT_PUBLIC_API_URL=http://216.238.107.59:3001
npm run dev
```

#### **Opção 2: Modificar config**
Editar `leaf-dashboard/src/config/index.ts`:
```typescript
export const config = {
  api: {
    baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://216.238.107.59:3001',
    // ...
  }
}
```

#### **Opção 3: Arquivo .env.local**
Criar `leaf-dashboard/.env.local`:
```
NEXT_PUBLIC_API_URL=http://216.238.107.59:3001
```

---

## 📊 Testar Dashboard

Após configurar a URL:

1. **Acessar dashboard:**
   ```
   http://localhost:3000/metrics
   ```

2. **Verificar se card "Places Cache" aparece**

3. **Verificar se métricas carregam**

---

## 🐛 Troubleshooting

### **Erro: "Cannot GET /api/places/metrics"**
- ✅ Verificar se código foi deployado
- ✅ Verificar se servidor foi reiniciado
- ✅ Verificar logs do servidor

### **Erro: "ENABLE_PLACES_CACHE=false"**
- ✅ Verificar variável de ambiente na VPS
- ✅ Não deve estar definida como "false"

### **Erro: "Redis connection failed"**
- ✅ Verificar se Redis está rodando na VPS
- ✅ Verificar `REDIS_URL` no config

### **Dashboard não carrega métricas**
- ✅ Verificar URL da API no dashboard
- ✅ Verificar CORS no servidor
- ✅ Verificar console do navegador (F12)

---

## 📝 Checklist de Deploy

- [ ] Backup do servidor atual
- [ ] Arquivos enviados para VPS
- [ ] Dependências instaladas
- [ ] Servidor reiniciado
- [ ] Endpoints testados (health, metrics)
- [ ] Logs verificados
- [ ] Dashboard configurado com URL da VPS
- [ ] Dashboard testado

---

## 🚀 Próximo Passo

**Fazer deploy dos arquivos novos na VPS e reiniciar o servidor.**

Quer que eu crie um script de deploy automatizado?




