# 🏠 SETUP SELF-HOSTED LOCAL - LEAF APP

## 🎯 **RODANDO 100% NA SUA CASA**

### **🏗️ ARQUITETURA LOCAL:**
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Mobile App    │    │  Seu Computador │    │  Firebase       │
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

## 🚀 **VANTAGENS DO LOCAL:**

### **💰 CUSTO ZERO:**
- **Servidor:** Seu computador
- **Internet:** Sua conexão
- **Custo:** $0/mês
- **Controle:** 100% seu

### **🔧 CONTROLE TOTAL:**
- **Dados:** 100% na sua casa
- **Configuração:** Personalizada
- **Backup:** Estratégia própria
- **Segurança:** Sua responsabilidade

---

## 📋 **REQUISITOS MÍNIMOS:**

### **💻 Hardware:**
```bash
# Mínimo:
- CPU: Dual Core 2.0GHz
- RAM: 4GB
- Storage: 20GB livre
- Internet: 10Mbps upload

# Recomendado:
- CPU: Quad Core 2.5GHz
- RAM: 8GB
- Storage: 50GB livre
- Internet: 50Mbps upload
```

### **🌐 Internet:**
```bash
# Necessário:
- IP fixo (ou DDNS)
- Porta 80 e 443 liberadas
- Upload mínimo 10Mbps
```

---

## 🔧 **IMPLEMENTAÇÃO LOCAL:**

### **PASSO 1: Instalar Dependências**
```bash
# No seu computador (Ubuntu/Linux):
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm redis-server nginx

# OU no Windows:
# Baixar: Node.js, Redis, Nginx
```

### **PASSO 2: Configurar Redis**
```bash
# Editar configuração Redis
sudo nano /etc/redis/redis.conf

# Configurações:
bind 127.0.0.1
port 6379
maxmemory 512mb
maxmemory-policy allkeys-lru
requirepass sua_senha_forte

# Reiniciar Redis
sudo systemctl restart redis-server
sudo systemctl enable redis-server
```

### **PASSO 3: Criar API Local**
```bash
# Criar diretório
mkdir ~/leaf-app-local
cd ~/leaf-app-local

# Criar package.json
npm init -y

# Instalar dependências
npm install express redis ws cors express-rate-limit dotenv
```

### **PASSO 4: Criar server.js**
```bash
# Copiar o conteúdo do arquivo self-hosted-api-example.js
cp /caminho/para/self-hosted-api-example.js server.js
```

### **PASSO 5: Configurar Nginx**
```bash
# Criar configuração
sudo nano /etc/nginx/sites-available/leaf-app-local

# Conteúdo:
server {
    listen 80;
    server_name SEU_IP_LOCAL;

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}

# Ativar
sudo ln -s /etc/nginx/sites-available/leaf-app-local /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

### **PASSO 6: Configurar Firewall**
```bash
# Liberar portas
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 3000
sudo ufw allow 3001
sudo ufw enable
```

### **PASSO 7: Configurar IP Fixo/DDNS**
```bash
# Opção 1: IP Fixo (contatar provedor)
# Opção 2: DDNS (gratuito)
# - No-IP: https://www.noip.com/
# - DuckDNS: https://www.duckdns.org/
```

---

## 📱 **CONFIGURAR MOBILE APP:**

### **ApiConfig.js Local:**
```javascript
const API_CONFIG = {
    // Local URLs
    BASE_URL: 'http://SEU_IP_LOCAL/api',
    WEBSOCKET_URL: 'ws://SEU_IP_LOCAL/ws',
    
    // Firebase (mantém para auth/database)
    FIREBASE_CONFIG: {
        // ... suas configurações Firebase
    }
};
```

---

## 🚨 **DESVANTAGENS DO LOCAL:**

### **⚠️ Problemas Comuns:**
```bash
# 1. IP Dinâmico
- IP muda frequentemente
- App para de funcionar
- Solução: DDNS

# 2. Internet Instável
- Conexão cai
- Upload lento
- Sem garantia de uptime

# 3. Segurança
- Sem firewall profissional
- Sem backup automático
- Sem monitoramento

# 4. Manutenção
- Você cuida de tudo
- Atualizações manuais
- Troubleshooting
```

---

## 🎯 **QUANDO USAR LOCAL:**

### **✅ Ideal para:**
- **Desenvolvimento/Testes**
- **Projetos pessoais**
- **Aprendizado**
- **Custo zero**

### **❌ Não ideal para:**
- **Produção comercial**
- **Muitos usuários**
- **Alta disponibilidade**
- **Aplicações críticas**

---

## 🔄 **MIGRAÇÃO FUTURA:**

### **Local → VPS:**
```bash
# Quando crescer:
1. Criar VPS ($10/mês)
2. Copiar configurações
3. Atualizar URLs no app
4. Testar e migrar
```

---

## 📊 **COMPARAÇÃO FINAL:**

| Aspecto | Local | VPS |
|---------|-------|-----|
| **Custo** | $0/mês | $10/mês |
| **Uptime** | ~80% | 99.9% |
| **Manutenção** | Você | Provedor |
| **Segurança** | Básica | Profissional |
| **Escalabilidade** | Limitada | Ilimitada |
| **Backup** | Manual | Automático |

---

## 🚀 **VAMOS IMPLEMENTAR LOCAL?**

### **Opção 1: Local (Casa)**
```bash
# Vantagens: $0/mês, controle total
# Desvantagens: IP dinâmico, manutenção
```

### **Opção 2: VPS (Nuvem)**
```bash
# Vantagens: IP fixo, 99.9% uptime
# Desvantagens: $10/mês
```

**🎯 Qual você prefere? Local para começar ou VPS para produção?**

**Para desenvolvimento/testes, local é perfeito! Para produção, VPS é melhor.** 