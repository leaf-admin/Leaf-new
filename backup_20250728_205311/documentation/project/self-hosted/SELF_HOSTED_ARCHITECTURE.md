# 🏠 ARQUITETURA SELF-HOSTED - LEAF APP

## 🎯 **VISÃO GERAL**

### **🏗️ ESTRUTURA PROPOSTA:**
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Mobile App    │    │  VPS/Server     │    │  Firebase       │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ React Native│ │◄──►│ │ Node.js API │ │◄──►│ │ Functions   │ │
│ │             │ │    │ │             │ │    │ │             │ │
│ │ ┌─────────┐ │ │    │ │ ┌─────────┐ │ │    │ │ ┌─────────┐ │ │
│ │ │Redis API│ │ │    │ │ │  Redis  │ │ │    │ │ │Database │ │ │
│ │ │         │ │ │    │ │ │         │ │ │    │ │ │         │ │ │
│ │ │WebSocket│ │ │    │ │ │WebSocket│ │ │    │ │ │Auth     │ │ │
│ │ └─────────┘ │ │    │ │ └─────────┘ │ │    │ │ └─────────┘ │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## 🚀 **VANTAGENS DO SELF-HOSTED**

### **1. 💰 CUSTOS REDUZIDOS**
```bash
# VPS Básico (DigitalOcean/AWS)
- 1GB RAM, 1 CPU: $5-10/mês
- 2GB RAM, 2 CPU: $10-20/mês
- Inclui: Redis, Node.js, WebSocket
- Economia: 70-80% vs Firebase Functions
```

### **2. 🔧 CONTROLE TOTAL**
- **Redis:** Configuração personalizada
- **APIs:** Sem limitações de timeout
- **WebSocket:** Latência mínima
- **Backup:** Estratégia própria
- **Monitoramento:** Customizado

### **3. 🚀 PERFORMANCE SUPERIOR**
```bash
# Latência comparada:
Firebase Functions: 200-500ms (cold start)
Self-hosted API: 50-100ms (sempre quente)
Redis local: 1-5ms
WebSocket: 10-50ms
```

### **4. 🔒 SEGURANÇA**
- **Dados:** 100% sob seu controle
- **Compliance:** Regulamentações específicas
- **Auditoria:** Logs completos
- **Isolamento:** Rede própria

---

## 📋 **IMPLEMENTAÇÃO PASSO A PASSO**

### **Passo 1: Configurar VPS**
```bash
# DigitalOcean Droplet
- Ubuntu 22.04 LTS
- 2GB RAM, 1 CPU
- 50GB SSD
- $10/mês
```

### **Passo 2: Instalar Dependências**
```bash
# Atualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instalar Redis
sudo apt install redis-server -y

# Instalar PM2 (Process Manager)
sudo npm install -g pm2
```

### **Passo 3: Configurar Redis**
```bash
# Editar configuração Redis
sudo nano /etc/redis/redis.conf

# Configurações importantes:
bind 127.0.0.1
port 6379
maxmemory 512mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
```

### **Passo 4: Deploy da API**
```bash
# Clonar projeto
git clone https://github.com/seu-repo/leaf-app.git
cd leaf-app

# Instalar dependências
npm install

# Configurar PM2
pm2 start server.js --name "leaf-api"
pm2 startup
pm2 save
```

### **Passo 5: Configurar Nginx**
```bash
# Instalar Nginx
sudo apt install nginx -y

# Configurar proxy reverso
sudo nano /etc/nginx/sites-available/leaf-app

# Configuração:
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### **Passo 6: Configurar SSL**
```bash
# Instalar Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obter certificado SSL
sudo certbot --nginx -d seu-dominio.com
```

---

## 🔧 **CONFIGURAÇÃO DO CÓDIGO**

### **1. API Server (server.js)**
```javascript
const express = require('express');
const redis = require('redis');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Redis Client
const redisClient = redis.createClient({
    host: 'localhost',
    port: 6379
});

// WebSocket Server
const wss = new WebSocket.Server({ port: 3001 });

// APIs Redis
app.post('/api/health', async (req, res) => {
    try {
        const status = await redisClient.ping();
        res.json({
            success: true,
            status: 'healthy',
            redis: status === 'PONG' ? 'connected' : 'disconnected',
            timestamp: Date.now()
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno' });
    }
});

app.post('/api/get_redis_stats', async (req, res) => {
    try {
        const stats = {
            activeTrips: await redisClient.scard('active_trips'),
            completedTrips: await redisClient.scard('completed_trips'),
            onlineUsers: await redisClient.scard('users:online'),
            timestamp: Date.now()
        };
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno' });
    }
});

// Iniciar servidor
app.listen(port, () => {
    console.log(`🚀 API rodando na porta ${port}`);
});
```

### **2. Mobile App (ApiConfig.js)**
```javascript
// Configuração para self-hosted
const API_CONFIG = {
    BASE_URL: 'https://seu-dominio.com/api',
    WEBSOCKET_URL: 'wss://seu-dominio.com:3001',
    TIMEOUT: 10000
};

export default API_CONFIG;
```

---

## 💰 **ANÁLISE DE CUSTOS**

### **Self-Hosted vs Firebase Functions**

| Componente | Self-Hosted | Firebase Functions |
|------------|-------------|-------------------|
| **VPS** | $10/mês | - |
| **Redis** | Incluído | $5-15/mês |
| **APIs** | Incluído | $0.40/1M requests |
| **WebSocket** | Incluído | $0.50/1M messages |
| **Total** | **$10/mês** | **$20-50/mês** |

### **Economia Estimada:**
- **70-80% de economia** vs Firebase Functions
- **Performance 5x melhor**
- **Controle total**

---

## 🔒 **SEGURANÇA**

### **1. Firewall**
```bash
# Configurar UFW
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 3000
sudo ufw allow 3001
```

### **2. SSL/TLS**
```bash
# Certificado gratuito (Let's Encrypt)
sudo certbot --nginx -d seu-dominio.com
```

### **3. Redis Security**
```bash
# Configurar senha Redis
sudo nano /etc/redis/redis.conf
requirepass sua_senha_forte
```

---

## 📊 **MONITORAMENTO**

### **1. PM2 Dashboard**
```bash
# Instalar PM2 Plus
pm2 install pm2-server-monit
pm2 install pm2-logrotate
```

### **2. Redis Monitoring**
```bash
# Redis INFO
redis-cli info

# Redis Stats
redis-cli info stats
```

### **3. Logs**
```bash
# Ver logs da aplicação
pm2 logs leaf-api

# Ver logs do Redis
sudo tail -f /var/log/redis/redis-server.log
```

---

## 🚀 **DEPLOY AUTOMATIZADO**

### **Script de Deploy (deploy.sh)**
```bash
#!/bin/bash

echo "🚀 Deploy Leaf App Self-Hosted"

# Pull latest code
git pull origin main

# Install dependencies
npm install

# Restart PM2
pm2 restart leaf-api

# Check status
pm2 status

echo "✅ Deploy concluído!"
```

---

## ✅ **BENEFÍCIOS FINAIS**

### **Performance:**
- **Latência:** 50-100ms (vs 200-500ms Firebase)
- **Throughput:** 10x maior
- **Cold Start:** Zero

### **Custos:**
- **Economia:** 70-80%
- **Previsível:** $10/mês fixo
- **Escalável:** Sem surpresas

### **Controle:**
- **Dados:** 100% seu
- **Configuração:** Personalizada
- **Backup:** Estratégia própria
- **Monitoramento:** Completo

---

**🚀 Pronto para implementar a arquitetura self-hosted?** 