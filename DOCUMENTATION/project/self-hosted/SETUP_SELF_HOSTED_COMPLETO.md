# 🚀 SETUP SELF-HOSTED COMPLETO - LEAF APP

## 🎯 **PLANO DE IMPLEMENTAÇÃO**

### **📋 ETAPAS:**
1. **Configurar VPS** (DigitalOcean/AWS)
2. **Instalar Dependências** (Node.js, Redis, PM2)
3. **Deploy da API** (Express.js + Redis)
4. **Configurar Nginx** (Proxy reverso)
5. **Configurar SSL** (Let's Encrypt)
6. **Atualizar Mobile App** (Novas URLs)
7. **Testar Sistema** (APIs + WebSocket)

---

## 🏗️ **PASSO 1: CONFIGURAR VPS**

### **1.1 Criar Droplet (DigitalOcean)**
```bash
# Acesse: https://cloud.digitalocean.com/droplets/new
# Configuração recomendada:
- Ubuntu 22.04 LTS
- 2GB RAM, 1 CPU
- 50GB SSD
- $10/mês
- Região: São Paulo (menor latência)
```

### **1.2 Conectar via SSH**
```bash
# No seu terminal local:
ssh root@SEU_IP_DO_VPS

# Exemplo:
ssh root@164.92.123.456
```

### **1.3 Configurar Usuário**
```bash
# Criar usuário não-root
adduser leaf
usermod -aG sudo leaf

# Configurar SSH para o novo usuário
cp ~/.ssh/authorized_keys /home/leaf/.ssh/
chown -R leaf:leaf /home/leaf/.ssh/
chmod 700 /home/leaf/.ssh/
chmod 600 /home/leaf/.ssh/authorized_keys

# Sair e reconectar como 'leaf'
exit
ssh leaf@SEU_IP_DO_VPS
```

---

## 🔧 **PASSO 2: INSTALAR DEPENDÊNCIAS**

### **2.1 Atualizar Sistema**
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install curl wget git unzip -y
```

### **2.2 Instalar Node.js**
```bash
# Instalar Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verificar instalação
node --version
npm --version
```

### **2.3 Instalar Redis**
```bash
# Instalar Redis
sudo apt install redis-server -y

# Configurar Redis
sudo nano /etc/redis/redis.conf

# Adicionar/modificar estas linhas:
bind 127.0.0.1
port 6379
maxmemory 512mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
requirepass SUA_SENHA_FORTE_AQUI

# Reiniciar Redis
sudo systemctl restart redis-server
sudo systemctl enable redis-server

# Testar Redis
redis-cli -a SUA_SENHA_FORTE_AQUI ping
```

### **2.4 Instalar PM2**
```bash
# Instalar PM2 globalmente
sudo npm install -g pm2

# Configurar PM2 para iniciar com o sistema
pm2 startup
# Execute o comando que aparecer
```

---

## 🚀 **PASSO 3: DEPLOY DA API**

### **3.1 Clonar Projeto**
```bash
# Criar diretório
mkdir /home/leaf/leaf-app
cd /home/leaf/leaf-app

# Clonar seu repositório (substitua pela sua URL)
git clone https://github.com/seu-usuario/leaf-app.git .
# OU criar manualmente se não tiver repositório
```

### **3.2 Criar API Server**
```bash
# Criar package.json
npm init -y

# Instalar dependências
npm install express redis ws cors express-rate-limit dotenv

# Criar arquivo .env
nano .env
```

### **3.3 Conteúdo do .env:**
```bash
# Configurações do Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=SUA_SENHA_FORTE_AQUI

# Configurações da API
PORT=3000
WEBSOCKET_PORT=3001

# Configurações de segurança
NODE_ENV=production
```

### **3.4 Criar server.js**
```bash
# Copiar o conteúdo do arquivo self-hosted-api-example.js
cp /caminho/para/self-hosted-api-example.js server.js
```

### **3.5 Iniciar com PM2**
```bash
# Iniciar aplicação
pm2 start server.js --name "leaf-api"

# Salvar configuração
pm2 save

# Verificar status
pm2 status
pm2 logs leaf-api
```

---

## 🌐 **PASSO 4: CONFIGURAR NGINX**

### **4.1 Instalar Nginx**
```bash
sudo apt install nginx -y
```

### **4.2 Configurar Site**
```bash
# Criar configuração do site
sudo nano /etc/nginx/sites-available/leaf-app
```

### **4.3 Conteúdo da configuração:**
```nginx
server {
    listen 80;
    server_name SEU_DOMINIO.com;  # Substitua pelo seu domínio

    # API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # WebSocket
    location /ws/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:3000/api/health;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### **4.4 Ativar Site**
```bash
# Criar link simbólico
sudo ln -s /etc/nginx/sites-available/leaf-app /etc/nginx/sites-enabled/

# Remover site padrão
sudo rm /etc/nginx/sites-enabled/default

# Testar configuração
sudo nginx -t

# Reiniciar Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## 🔒 **PASSO 5: CONFIGURAR SSL**

### **5.1 Instalar Certbot**
```bash
sudo apt install certbot python3-certbot-nginx -y
```

### **5.2 Obter Certificado SSL**
```bash
# Substitua pelo seu domínio
sudo certbot --nginx -d SEU_DOMINIO.com

# Seguir as instruções na tela
# Escolher: 2 (redirect all traffic to HTTPS)
```

### **5.3 Verificar Renovação Automática**
```bash
# Testar renovação automática
sudo certbot renew --dry-run
```

---

## 📱 **PASSO 6: ATUALIZAR MOBILE APP**

### **6.1 Criar novo ApiConfig.js**
```javascript
// mobile-app/src/config/ApiConfig.js
const API_CONFIG = {
    // Self-hosted URLs
    BASE_URL: 'https://SEU_DOMINIO.com/api',
    WEBSOCKET_URL: 'wss://SEU_DOMINIO.com/ws',
    
    // Firebase (mantém para auth/database)
    FIREBASE_CONFIG: {
        // ... suas configurações Firebase
    },
    
    // Timeouts
    TIMEOUT: 10000,
    WEBSOCKET_TIMEOUT: 5000
};

export default API_CONFIG;
```

### **6.2 Atualizar HybridMapsService.js**
```javascript
// Adicionar no início do arquivo:
const API_CONFIG = require('../config/ApiConfig.cjs').default;

// Atualizar URLs das APIs Redis:
const REDIS_API_BASE = API_CONFIG.BASE_URL;
```

---

## 🧪 **PASSO 7: TESTAR SISTEMA**

### **7.1 Testar APIs**
```bash
# Health check
curl -X POST https://SEU_DOMINIO.com/api/health

# Redis stats
curl -X POST https://SEU_DOMINIO.com/api/get_redis_stats

# Update location
curl -X POST https://SEU_DOMINIO.com/api/update_user_location \
  -H "Content-Type: application/json" \
  -d '{"userId":"test123","latitude":-23.5505,"longitude":-46.6333}'
```

### **7.2 Testar WebSocket**
```bash
# Instalar wscat para testar WebSocket
npm install -g wscat

# Conectar ao WebSocket
wscat -c wss://SEU_DOMINIO.com/ws
```

### **7.3 Testar Mobile App**
```bash
# No seu ambiente de desenvolvimento:
cd mobile-app
npm start

# Testar no emulador/dispositivo
```

---

## 📊 **PASSO 8: MONITORAMENTO**

### **8.1 PM2 Dashboard**
```bash
# Ver status
pm2 status

# Ver logs
pm2 logs leaf-api

# Monitor em tempo real
pm2 monit
```

### **8.2 Redis Monitoring**
```bash
# Conectar ao Redis
redis-cli -a SUA_SENHA_FORTE_AQUI

# Ver estatísticas
INFO stats

# Ver memória
INFO memory
```

### **8.3 Nginx Logs**
```bash
# Ver logs de acesso
sudo tail -f /var/log/nginx/access.log

# Ver logs de erro
sudo tail -f /var/log/nginx/error.log
```

---

## 🔄 **PASSO 9: DEPLOY AUTOMATIZADO**

### **9.1 Criar Script de Deploy**
```bash
# Criar deploy.sh
nano /home/leaf/leaf-app/deploy.sh
```

### **9.2 Conteúdo do deploy.sh:**
```bash
#!/bin/bash

echo "🚀 Deploy Leaf App Self-Hosted"

# Ir para diretório do projeto
cd /home/leaf/leaf-app

# Pull latest code (se usar git)
# git pull origin main

# Instalar dependências
npm install

# Reiniciar PM2
pm2 restart leaf-api

# Verificar status
pm2 status

echo "✅ Deploy concluído!"
echo "📊 Status: https://SEU_DOMINIO.com/health"
```

### **9.3 Tornar Executável**
```bash
chmod +x /home/leaf/leaf-app/deploy.sh
```

---

## ✅ **CHECKLIST FINAL**

### **✅ VPS Configurado:**
- [ ] Droplet criado
- [ ] SSH configurado
- [ ] Usuário criado

### **✅ Dependências Instaladas:**
- [ ] Node.js 18.x
- [ ] Redis configurado
- [ ] PM2 instalado

### **✅ API Deployada:**
- [ ] server.js criado
- [ ] .env configurado
- [ ] PM2 rodando

### **✅ Nginx Configurado:**
- [ ] Proxy reverso
- [ ] WebSocket proxy
- [ ] SSL configurado

### **✅ Mobile App Atualizado:**
- [ ] ApiConfig.js atualizado
- [ ] URLs self-hosted
- [ ] Testado localmente

### **✅ Sistema Testado:**
- [ ] APIs funcionando
- [ ] WebSocket funcionando
- [ ] SSL funcionando

---

## 🎯 **PRÓXIMOS PASSOS**

### **1. Configurar Domínio:**
- Comprar domínio (ex: leaf-app.com)
- Configurar DNS
- Atualizar URLs no código

### **2. Configurar Backup:**
- Backup automático do Redis
- Backup dos logs
- Estratégia de recuperação

### **3. Configurar Monitoramento:**
- Alertas de downtime
- Monitoramento de performance
- Logs centralizados

### **4. Otimizações:**
- CDN para assets estáticos
- Cache Redis otimizado
- Load balancing (se necessário)

---

**🚀 Pronto para começar? Qual etapa você quer fazer primeiro?** 