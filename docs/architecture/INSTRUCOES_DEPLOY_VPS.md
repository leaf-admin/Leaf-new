# 🚀 Instruções de Deploy - Places Cache na VPS

## 📍 Situação Atual

- ✅ Código implementado localmente
- ❌ Código **ainda não deployado** na VPS (216.238.107.59)
- ❌ Endpoints não disponíveis na VPS ainda

---

## 🚀 Deploy Rápido

### **Opção 1: Script Automatizado (Recomendado)**

```bash
# No diretório raiz do projeto
./deploy-places-cache-vps.sh
```

O script vai:
1. ✅ Verificar arquivos
2. ✅ Testar conexão SSH
3. ✅ Fazer backup do server.js
4. ✅ Enviar arquivos novos
5. ✅ Reiniciar servidor
6. ✅ Testar endpoints

---

### **Opção 2: Deploy Manual**

#### **1. Enviar arquivos para VPS:**

```bash
# Do seu PC local
scp leaf-websocket-backend/services/places-cache-service.js root@216.238.107.59:/root/leaf-websocket-backend/services/
scp leaf-websocket-backend/routes/places-routes.js root@216.238.107.59:/root/leaf-websocket-backend/routes/
scp leaf-websocket-backend/utils/places-normalizer.js root@216.238.107.59:/root/leaf-websocket-backend/utils/
scp leaf-websocket-backend/server.js root@216.238.107.59:/root/leaf-websocket-backend/
```

#### **2. Conectar na VPS:**

```bash
ssh root@216.238.107.59
```

#### **3. Na VPS, fazer backup e reiniciar:**

```bash
cd /root/leaf-websocket-backend

# Backup
cp server.js server.js.backup-$(date +%Y%m%d-%H%M%S)

# Instalar dependências (se necessário)
npm install

# Reiniciar servidor (escolha uma opção):
# Opção A: PM2
pm2 restart leaf-websocket-backend

# Opção B: systemd
systemctl restart leaf-backend

# Opção C: Processo direto
pkill -f 'node.*server.js'
nohup node server.js > server.log 2>&1 &
```

#### **4. Testar:**

```bash
# Na VPS ou do seu PC
curl http://216.238.107.59:3001/api/places/health
curl http://216.238.107.59:3001/api/places/metrics
```

---

## 🔧 Configurar Dashboard para VPS

### **Opção 1: Variável de Ambiente (Recomendado)**

Criar arquivo `leaf-dashboard/.env.local`:
```
NEXT_PUBLIC_API_URL=http://216.238.107.59:3001
```

### **Opção 2: Modificar Config**

Já atualizei `leaf-dashboard/src/config/index.ts` para usar VPS automaticamente quando não estiver em localhost.

---

## ✅ Verificação Pós-Deploy

### **1. Testar Endpoints:**

```bash
# Health Check
curl http://216.238.107.59:3001/api/places/health

# Métricas
curl http://216.238.107.59:3001/api/places/metrics
```

**Resposta esperada:**
```json
{
  "status": "success",
  "metrics": {
    "hits": 0,
    "misses": 0,
    "saves": 0,
    "errors": 0,
    "totalRequests": 0,
    "hitRate": "0%",
    ...
  }
}
```

### **2. Verificar Logs:**

```bash
# Na VPS
tail -f /root/leaf-websocket-backend/server.log

# Procurar por:
# ✅ Rotas de Places Cache registradas
# ✅ Places Cache Service inicializado
```

### **3. Testar Dashboard:**

1. Acessar: `http://localhost:3000/metrics` (ou URL do dashboard)
2. Verificar se card "Places Cache - Monitoramento" aparece
3. Verificar se métricas carregam

---

## 🐛 Troubleshooting

### **Erro: "Cannot GET /api/places/metrics"**
- ✅ Verificar se arquivos foram enviados
- ✅ Verificar se servidor foi reiniciado
- ✅ Verificar logs do servidor

### **Erro: "ENABLE_PLACES_CACHE=false"**
- ✅ Verificar variável de ambiente na VPS
- ✅ Não deve estar definida como "false"

### **Erro: "Redis connection failed"**
- ✅ Verificar se Redis está rodando: `redis-cli ping`
- ✅ Verificar `REDIS_URL` no config

### **Dashboard não carrega métricas**
- ✅ Verificar URL da API no dashboard
- ✅ Verificar CORS no servidor
- ✅ Verificar console do navegador (F12)

---

## 📝 Checklist

- [ ] Arquivos enviados para VPS
- [ ] Servidor reiniciado
- [ ] Endpoints testados (health, metrics)
- [ ] Logs verificados
- [ ] Dashboard configurado com URL da VPS
- [ ] Dashboard testado

---

## 🎯 Próximo Passo

**Executar o script de deploy:**
```bash
./deploy-places-cache-vps.sh
```

Ou fazer deploy manual seguindo os passos acima.




