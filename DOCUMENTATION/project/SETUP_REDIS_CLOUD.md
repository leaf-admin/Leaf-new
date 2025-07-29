# 🚀 SETUP REDIS CLOUD - GUIA COMPLETO

## 🎯 **OPÇÕES RECOMENDADAS**

### **1. 🆓 UPSTASH (RECOMENDADO - GRATUITO)**
- **URL:** https://upstash.com/
- **Limite:** 10.000 requests/mês grátis
- **Setup:** 2 minutos
- **Preço:** $0.20/100k requests após limite

### **2. 🆓 REDIS CLOUD (ALTERNATIVA)**
- **URL:** https://redis.com/try-free/
- **Limite:** 30MB grátis
- **Setup:** 5 minutos
- **Preço:** $5/mês (100MB)

---

## 📋 **PASSO A PASSO - UPSTASH**

### **Passo 1: Criar Conta**
1. Acesse: https://upstash.com/
2. Clique em "Get Started"
3. Faça login com GitHub/Google
4. Clique em "Create Database"

### **Passo 2: Configurar Database**
1. **Name:** `leaf-app-redis`
2. **Region:** `us-east-1` (mais próximo)
3. **TLS:** `Enabled`
4. **Eviction Policy:** `volatile-lru`
5. Clique em "Create"

### **Passo 3: Obter Credenciais**
Após criar, você receberá:
```bash
UPSTASH_REDIS_REST_URL=https://us-east-1-1.aws.cloud.upstash.io
UPSTASH_REDIS_REST_TOKEN=seu_token_aqui
```

### **Passo 4: Configurar Environment Variables**
```bash
# No Firebase Functions
REDIS_HOST=us-east-1-1.aws.cloud.upstash.io
REDIS_PORT=443
REDIS_PASSWORD=seu_token_aqui
REDIS_TLS=true
```

---

## 🔧 **CONFIGURAÇÃO NO CÓDIGO**

### **1. Atualizar redis-api.js**
```javascript
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || 'us-east-1-1.aws.cloud.upstash.io',
    port: process.env.REDIS_PORT || 443,
    password: process.env.REDIS_PASSWORD || 'seu_token_aqui',
    db: process.env.REDIS_DB || 0,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined
};
```

### **2. Deploy das Functions**
```bash
firebase deploy --only functions:get_redis_stats,functions:health,functions:update_user_location,functions:get_user_location,functions:get_nearby_drivers,functions:start_trip_tracking,functions:update_trip_location,functions:end_trip_tracking,functions:get_trip_data
```

---

## 🧪 **TESTE APÓS CONFIGURAÇÃO**

### **1. Teste Básico**
```bash
curl -s -X POST "https://us-central1-leaf-reactnative.cloudfunctions.net/health" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### **2. Teste Completo**
```bash
cd mobile-app
node test-redis-apis-final.cjs
```

---

## 💰 **CUSTOS ESTIMADOS**

### **Upstash (Gratuito)**
- **10.000 requests/mês:** GRÁTIS
- **100.000 requests/mês:** $0.20
- **1.000.000 requests/mês:** $2.00

### **Redis Cloud (Pago)**
- **30MB grátis:** GRÁTIS
- **100MB:** $5/mês
- **1GB:** $15/mês

---

## 🎯 **PRÓXIMOS PASSOS**

1. **Escolher provedor** (Upstash recomendado)
2. **Criar conta e database**
3. **Obter credenciais**
4. **Configurar environment variables**
5. **Atualizar código**
6. **Deploy das functions**
7. **Testar APIs**

---

## ✅ **BENEFÍCIOS APÓS CONFIGURAÇÃO**

- **✅ APIs Redis funcionando**
- **✅ Performance otimizada**
- **✅ Escalabilidade automática**
- **✅ Backup automático**
- **✅ Monitoramento incluído**
- **✅ 99.9% uptime**

---

**🚀 Vamos começar? Qual provedor você prefere?** 