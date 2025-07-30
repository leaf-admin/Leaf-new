# 🚀 GUIA RÁPIDO - LEAF APP NA HOSTINGER VPS

## 📋 **SITUAÇÃO ATUAL:**
- **VPS IP:** 147.93.66.253
- **Configuração:** 2 vCPU, 8GB RAM, 100GB NVMe
- **Serviços existentes:** BT-Panel, Nginx, MySQL, PHP-FPM
- **Portas em uso:** 80, 443, 888, 3306, 21, 22

## 🎯 **ESTRATÉGIA:**
Manter o painel existente e adicionar o Leaf App nas portas 3000/3001

---

## 🚀 **OPÇÃO 1: DEPLOY AUTOMATIZADO (RECOMENDADO)**

### **Execute este comando:**
```bash
./deploy-to-hostinger.sh
```

**O que faz:**
- ✅ Conecta à sua VPS
- ✅ Instala Node.js 18
- ✅ Instala e configura Redis
- ✅ Cria API completa do Leaf App
- ✅ Configura PM2 para gerenciamento
- ✅ Abre portas no firewall
- ✅ Inicia automaticamente

---

## 🔧 **OPÇÃO 2: DEPLOY MANUAL**

### **1. Conectar à VPS:**
```bash
ssh root@147.93.66.253
```

### **2. Verificar Node.js:**
```bash
node --version
npm --version
```

### **3. Se não tiver Node.js:**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs
```

### **4. Instalar Redis:**
```bash
apt update
apt install -y redis-server

# Configurar Redis
sed -i 's/bind 127.0.0.1/bind 0.0.0.0/' /etc/redis/redis.conf
sed -i 's/# requirepass foobared/requirepass leaf_redis_2024/' /etc/redis/redis.conf
sed -i 's/maxmemory 256mb/maxmemory 2gb/' /etc/redis/redis.conf

systemctl enable redis-server
systemctl start redis-server
```

### **5. Executar setup:**
```bash
./setup-hostinger-leaf.sh
```

---

## 🎯 **APÓS O DEPLOY:**

### **✅ URLs do Leaf App:**
- **API:** http://147.93.66.253:3000
- **WebSocket:** ws://147.93.66.253:3001
- **Health Check:** http://147.93.66.253:3000/api/health
- **Stats:** http://147.93.66.253:3000/api/stats

### **🔧 Comandos úteis:**
```bash
# Verificar status
ssh root@147.93.66.253 'pm2 status'

# Ver logs
ssh root@147.93.66.253 'pm2 logs leaf-api'

# Reiniciar
ssh root@147.93.66.253 'pm2 restart leaf-api'

# Parar
ssh root@147.93.66.253 'pm2 stop leaf-api'
```

### **🔑 Credenciais:**
- **Redis Password:** leaf_redis_2024
- **Diretório:** /opt/leaf-app

---

## 📊 **APIs DISPONÍVEIS:**

### **📍 Atualizar localização do usuário:**
```bash
POST http://147.93.66.253:3000/api/update_user_location
{
  "userId": "user123",
  "lat": -23.5505,
  "lng": -46.6333
}
```

### **🚗 Atualizar localização do motorista:**
```bash
POST http://147.93.66.253:3000/api/update_driver_location
{
  "driverId": "driver456",
  "lat": -23.5505,
  "lng": -46.6333,
  "status": "available"
}
```

### **🔍 Buscar motoristas próximos:**
```bash
GET http://147.93.66.253:3000/api/nearby_drivers?lat=-23.5505&lng=-46.6333&radius=5
```

### **📊 Estatísticas:**
```bash
GET http://147.93.66.253:3000/api/stats
```

---

## 🔄 **PRÓXIMOS PASSOS:**

### **1. Testar APIs:**
```bash
# Health check
curl http://147.93.66.253:3000/api/health

# Stats
curl http://147.93.66.253:3000/api/stats
```

### **2. Configurar no Mobile App:**
- Atualizar `ApiConfig.js` com as novas URLs
- Testar conexão WebSocket
- Verificar integração com Redis

### **3. Configurar domínio (opcional):**
- Comprar domínio
- Configurar DNS
- Configurar SSL/HTTPS

---

## ⚠️ **IMPORTANTE:**

### **🔒 Segurança:**
- Firewall configurado
- Redis com senha
- Rate limiting ativo
- CORS configurado

### **📊 Monitoramento:**
- PM2 para gerenciamento de processos
- Logs automáticos
- Health checks

### **🔄 Backup:**
- Redis data em /var/lib/redis
- Código em /opt/leaf-app
- Configurações em /etc/redis/redis.conf

---

## 🎯 **VANTAGENS DESTA CONFIGURAÇÃO:**

### **✅ Performance:**
- 8GB RAM disponível
- 2 vCPU dedicados
- NVMe SSD para velocidade
- Redis otimizado

### **✅ Controle:**
- Self-hosted completo
- Sem dependência de Firebase Functions
- Controle total sobre dados
- Customização ilimitada

### **✅ Custo:**
- VPS já pago
- Sem custos adicionais
- Escalabilidade controlada

### **✅ Confiabilidade:**
- Sem timeouts do Firebase
- Latência baixa
- Uptime garantido

---

## 🚀 **EXECUTAR AGORA?**

**Escolha uma opção:**

### **Opção A - Automatizado:**
```bash
./deploy-to-hostinger.sh
```

### **Opção B - Manual:**
```bash
ssh root@147.93.66.253
./setup-hostinger-leaf.sh
```

**Qual você prefere?** 🚀 