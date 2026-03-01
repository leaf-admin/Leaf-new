# 📋 Todos os Endpoints - VPS (216.238.107.59:3001)

## 🎯 Base URL
**VPS:** `http://216.238.107.59:3001`

---

## 🗺️ Places Cache (NOVO - Após Deploy)

### `GET /api/places/metrics` ⭐ **MONITORAMENTO**
**URL:** `http://216.238.107.59:3001/api/places/metrics`

**Resposta:**
```json
{
  "status": "success",
  "metrics": {
    "hits": 150,
    "misses": 50,
    "saves": 45,
    "errors": 2,
    "totalRequests": 200,
    "hitRate": "75.00%",
    "missRate": "25.00%",
    "stats": {
      "hitRate": 75.0,
      "efficiency": "75.00%"
    }
  }
}
```

### `GET /api/places/health`
**URL:** `http://216.238.107.59:3001/api/places/health`

### `POST /api/places/search`
**URL:** `http://216.238.107.59:3001/api/places/search`

### `POST /api/places/save`
**URL:** `http://216.238.107.59:3001/api/places/save`

---

## 📊 Métricas Principais

### `GET /api/metrics/rides/daily`
Corridas do dia

### `GET /api/metrics/users/status`
Status de usuários (customers/drivers online/offline)

### `GET /api/metrics/financial/rides`
Métricas financeiras de corridas

### `GET /api/metrics/maps/rides-by-region`
Corridas por região (para mapas)

### `GET /api/metrics/maps/demand-by-region`
Demanda por região (para mapas)

### `GET /api/metrics/subscriptions/active`
Assinaturas ativas

### `GET /api/metrics/waitlist/landing`
Waitlist da landing page

### `GET /api/metrics/landing-page/analytics`
Analytics da landing page

---

## 🚦 Filas e Matching

### `GET /api/queue/status`
Status das filas de corridas

### `GET /api/queue/metrics`
Métricas das filas

### `GET /api/queue/worker/stats`
Estatísticas do worker

---

## 👥 Usuários e Motoristas

### `GET /api/users/stats`
Estatísticas de usuários

### `GET /api/drivers/applications`
Aplicações de motoristas

### `GET /api/drivers/active`
Motoristas ativos

---

## 🔍 KYC

### `GET /api/kyc/stats`
Estatísticas KYC

### `GET /api/kyc-analytics/analytics`
Analytics KYC

---

## 📊 Dashboard

### `GET /api/live/stats`
Estatísticas em tempo real

### `GET /api/monitoring/health`
Health check geral

### `GET /api/monitoring/performance`
Performance do sistema

---

## 🎨 Dashboard Web - Conectado à VPS

### **URL do Dashboard:**
- Local: `http://localhost:3000`
- Produção: (sua URL do dashboard)

### **Configuração:**
✅ Dashboard já configurado para usar VPS automaticamente:
- Se `localhost` → usa `localhost:3001`
- Se não → usa `216.238.107.59:3001`

### **Página de Métricas:**
```
http://localhost:3000/metrics
```

**Card "Places Cache - Monitoramento" mostra:**
- ⚡ Hit Rate (com cores: verde/amarelo/vermelho)
- 📉 Miss Rate
- 💾 Lugares Salvos
- 📊 Eficiência
- ⚠️ Alertas automáticos

---

## 🚀 Deploy Necessário

### **Status Atual:**
- ✅ Código implementado localmente
- ❌ **Código ainda não deployado na VPS**
- ❌ Endpoints não disponíveis na VPS ainda

### **Para Deploy:**

**Opção 1: Script Automatizado**
```bash
./deploy-places-cache-vps.sh
```

**Opção 2: Manual**
```bash
# Enviar arquivos
scp leaf-websocket-backend/services/places-cache-service.js root@216.238.107.59:/root/leaf-websocket-backend/services/
scp leaf-websocket-backend/routes/places-routes.js root@216.238.107.59:/root/leaf-websocket-backend/routes/
scp leaf-websocket-backend/utils/places-normalizer.js root@216.238.107.59:/root/leaf-websocket-backend/utils/
scp leaf-websocket-backend/server.js root@216.238.107.59:/root/leaf-websocket-backend/

# Reiniciar servidor na VPS
ssh root@216.238.107.59
cd /root/leaf-websocket-backend
pm2 restart leaf-websocket-backend
```

---

## 📊 Testar Após Deploy

```bash
# Health Check
curl http://216.238.107.59:3001/api/places/health

# Métricas
curl http://216.238.107.59:3001/api/places/metrics
```

---

## 🎯 Resumo

**Endpoints disponíveis na VPS:** 100+ endpoints

**Places Cache (após deploy):**
- ✅ `/api/places/metrics` - Monitoramento
- ✅ `/api/places/health` - Health check
- ✅ `/api/places/search` - Buscar
- ✅ `/api/places/save` - Salvar

**Dashboard:**
- ✅ Configurado para VPS automaticamente
- ✅ Card de Places Cache na página `/metrics`
- ✅ Atualização automática a cada 30s

**Próximo passo:** Fazer deploy na VPS! 🚀




