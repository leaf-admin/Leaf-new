#!/bin/bash

# 🚀 SETUP SELF-HOSTED AUTOMATIZADO - LEAF APP
# Execute este script no VPS após conectar via SSH

echo "🚀 SETUP SELF-HOSTED - LEAF APP"
echo "=================================="

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para log
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERRO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCESSO]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

# Verificar se está rodando como root
if [ "$EUID" -ne 0 ]; then
    error "Este script deve ser executado como root"
    exit 1
fi

# ===== PASSO 1: ATUALIZAR SISTEMA =====
log "Atualizando sistema..."
apt update && apt upgrade -y
apt install -y curl wget git unzip htop

# ===== PASSO 2: INSTALAR NODE.JS =====
log "Instalando Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Verificar instalação
if command -v node &> /dev/null; then
    success "Node.js instalado: $(node --version)"
else
    error "Falha na instalação do Node.js"
    exit 1
fi

# ===== PASSO 3: INSTALAR REDIS =====
log "Instalando Redis..."
apt install -y redis-server

# Configurar Redis
log "Configurando Redis..."
cat > /etc/redis/redis.conf << EOF
# Configuração Redis para Leaf App
bind 216.238.107.59
port 6379
maxmemory 512mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
requirepass leaf_redis_2024
timeout 300
tcp-keepalive 60
EOF

# Reiniciar Redis
systemctl restart redis-server
systemctl enable redis-server

# Testar Redis
if redis-cli -a leaf_redis_2024 ping | grep -q "PONG"; then
    success "Redis configurado e funcionando"
else
    error "Falha na configuração do Redis"
    exit 1
fi

# ===== PASSO 4: INSTALAR PM2 =====
log "Instalando PM2..."
npm install -g pm2

# Configurar PM2 para iniciar com o sistema
pm2 startup
success "PM2 instalado"

# ===== PASSO 5: INSTALAR NGINX =====
log "Instalando Nginx..."
apt install -y nginx

# Configurar Nginx
log "Configurando Nginx..."
cat > /etc/nginx/sites-available/leaf-app << 'EOF'
server {
    listen 80;
    server_name _;  # Aceita qualquer domínio

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

    # Logs
    access_log /var/log/nginx/leaf-app-access.log;
    error_log /var/log/nginx/leaf-app-error.log;
}
EOF

# Ativar site
ln -sf /etc/nginx/sites-available/leaf-app /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Testar configuração
if nginx -t; then
    systemctl restart nginx
    systemctl enable nginx
    success "Nginx configurado"
else
    error "Erro na configuração do Nginx"
    exit 1
fi

# ===== PASSO 6: CRIAR USUÁRIO LEAF =====
log "Criando usuário leaf..."
if id "leaf" &>/dev/null; then
    warning "Usuário leaf já existe"
else
    useradd -m -s /bin/bash leaf
    usermod -aG sudo leaf
    success "Usuário leaf criado"
fi

# ===== PASSO 7: CRIAR DIRETÓRIO DO PROJETO =====
log "Criando diretório do projeto..."
mkdir -p /home/leaf/leaf-app
cd /home/leaf/leaf-app

# ===== PASSO 8: CRIAR PACKAGE.JSON =====
log "Criando package.json..."
cat > package.json << 'EOF'
{
  "name": "leaf-app-api",
  "version": "1.0.0",
  "description": "Leaf App Self-Hosted API",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": ["leaf", "api", "redis", "websocket"],
  "author": "Leaf Team",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "redis": "^4.6.10",
    "ws": "^8.14.2",
    "cors": "^2.8.5",
    "express-rate-limit": "^6.10.0",
    "dotenv": "^16.3.1"
  }
}
EOF

# ===== PASSO 9: CRIAR ARQUIVO .ENV =====
log "Criando arquivo .env..."
cat > .env << 'EOF'
# Configurações do Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=leaf_redis_2024

# Configurações da API
PORT=3000
WEBSOCKET_PORT=3001

# Configurações de segurança
NODE_ENV=production
EOF

# ===== PASSO 10: CRIAR SERVER.JS =====
log "Criando server.js..."
cat > server.js << 'EOF'
// 🏠 SELF-HOSTED API - LEAF APP
const express = require('express');
const redis = require('redis');
const WebSocket = require('ws');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Muitas requisições, tente novamente em 15 minutos'
});
app.use(limiter);

// Redis Client
const redisClient = redis.createClient({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || null,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3
});

redisClient.on('connect', () => {
    console.log('✅ Redis conectado (Self-Hosted)');
});

redisClient.on('error', (err) => {
    console.error('❌ Erro Redis:', err);
});

// WebSocket Server
const wss = new WebSocket.Server({ port: process.env.WEBSOCKET_PORT || 3001 });

wss.on('connection', (ws) => {
    console.log('🔗 Nova conexão WebSocket');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Mensagem recebida:', data);
            
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 Conexão WebSocket fechada');
    });
});

// APIs
app.post('/api/health', async (req, res) => {
    try {
        const status = await redisClient.ping();
        res.json({
            success: true,
            status: 'healthy',
            redis: status === 'PONG' ? 'connected' : 'disconnected',
            timestamp: Date.now(),
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro no health check:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/get_redis_stats', async (req, res) => {
    try {
        const stats = {
            activeTrips: await redisClient.scard('active_trips'),
            completedTrips: await redisClient.scard('completed_trips'),
            cancelledTrips: await redisClient.scard('cancelled_trips'),
            onlineUsers: await redisClient.scard('users:online'),
            totalTrips: await redisClient.scard('active_trips') + await redisClient.scard('completed_trips') + await redisClient.scard('cancelled_trips'),
            redisConnected: true,
            timestamp: Date.now(),
            source: 'self-hosted'
        };

        res.json({
            success: true,
            stats: stats,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/update_user_location', async (req, res) => {
    try {
        const { userId, latitude, longitude, timestamp } = req.body;
        
        if (!userId || !latitude || !longitude) {
            return res.status(400).json({ error: 'userId, latitude e longitude são obrigatórios' });
        }

        await redisClient.geoAdd('user_locations', {
            longitude: parseFloat(longitude),
            latitude: parseFloat(latitude),
            member: userId
        });
        
        await redisClient.hSet(`locations:${userId}`, {
            lat: latitude.toString(),
            lng: longitude.toString(),
            timestamp: (timestamp || Date.now()).toString(),
            updated_at: Date.now().toString()
        });

        await redisClient.sAdd('users:online', userId);

        res.json({
            success: true,
            message: 'Localização atualizada com sucesso',
            userId: userId,
            coordinates: { lat: latitude, lng: longitude },
            timestamp: timestamp || Date.now(),
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/get_nearby_drivers', async (req, res) => {
    try {
        const { latitude, longitude, radius = 5 } = req.body;
        
        if (!latitude || !longitude) {
            return res.status(400).json({ error: 'latitude e longitude são obrigatórios' });
        }

        const nearbyUsers = await redisClient.geoRadius('user_locations', {
            longitude: parseFloat(longitude),
            latitude: parseFloat(latitude),
            radius: radius,
            unit: 'km'
        });

        const drivers = [];
        for (const userId of nearbyUsers) {
            const locationData = await redisClient.hGetAll(`locations:${userId}`);
            if (locationData.lat && locationData.lng) {
                const distance = calculateDistance(
                    latitude, longitude,
                    parseFloat(locationData.lat), parseFloat(locationData.lng)
                );
                
                drivers.push({
                    uid: userId,
                    coordinates: { 
                        lat: parseFloat(locationData.lat), 
                        lng: parseFloat(locationData.lng) 
                    },
                    distance: Math.round(distance),
                    timestamp: parseInt(locationData.timestamp)
                });
            }
        }

        drivers.sort((a, b) => a.distance - b.distance);

        res.json({
            success: true,
            drivers: drivers,
            total: drivers.length,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao buscar motoristas próximos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/start_trip_tracking', async (req, res) => {
    try {
        const { tripId, driverId, passengerId, initialLocation } = req.body;
        
        if (!tripId || !driverId || !passengerId || !initialLocation) {
            return res.status(400).json({ error: 'tripId, driverId, passengerId e initialLocation são obrigatórios' });
        }

        const tripData = {
            tripId,
            driverId,
            passengerId,
            startTime: Date.now(),
            startLocation: initialLocation,
            status: 'active',
            updates: []
        };

        await redisClient.hSet(`trip:${tripId}`, tripData);
        await redisClient.sAdd('active_trips', tripId);

        res.json({
            success: true,
            tripId: tripId,
            status: 'active',
            startTime: tripData.startTime,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar tracking:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/update_trip_location', async (req, res) => {
    try {
        const { tripId, latitude, longitude, timestamp = Date.now() } = req.body;
        
        if (!tripId || !latitude || !longitude) {
            return res.status(400).json({ error: 'tripId, latitude e longitude são obrigatórios' });
        }

        const locationUpdate = {
            lat: latitude,
            lng: longitude,
            timestamp: timestamp
        };

        await redisClient.lPush(`trip_path:${tripId}`, JSON.stringify(locationUpdate));
        await redisClient.hSet(`trip:${tripId}`, {
            currentLocation: JSON.stringify(locationUpdate),
            lastUpdate: timestamp
        });

        res.json({
            success: true,
            tripId: tripId,
            location: locationUpdate,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização da viagem:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/end_trip_tracking', async (req, res) => {
    try {
        const { tripId, endLocation } = req.body;
        
        if (!tripId || !endLocation) {
            return res.status(400).json({ error: 'tripId e endLocation são obrigatórios' });
        }

        const tripData = await redisClient.hGetAll(`trip:${tripId}`);
        
        if (!tripData.tripId) {
            return res.status(404).json({ error: 'Viagem não encontrada' });
        }

        const updatedTripData = {
            ...tripData,
            endTime: Date.now(),
            endLocation: endLocation,
            status: 'completed',
            duration: Date.now() - parseInt(tripData.startTime)
        };

        await redisClient.hSet(`trip:${tripId}`, updatedTripData);
        await redisClient.sRem('active_trips', tripId);
        await redisClient.sAdd('completed_trips', tripId);

        res.json({
            success: true,
            tripId: tripId,
            status: 'completed',
            endTime: updatedTripData.endTime,
            duration: updatedTripData.duration,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao finalizar tracking:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/get_trip_data', async (req, res) => {
    try {
        const { tripId } = req.body;
        
        if (!tripId) {
            return res.status(400).json({ error: 'tripId é obrigatório' });
        }

        const tripData = await redisClient.hGetAll(`trip:${tripId}`);
        
        if (!tripData.tripId) {
            return res.status(404).json({ error: 'Viagem não encontrada' });
        }

        const pathData = await redisClient.lRange(`trip_path:${tripId}`, 0, -1);
        const path = pathData.map(point => JSON.parse(point));

        res.json({
            success: true,
            tripData: tripData,
            path: path,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao obter dados da viagem:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

app.listen(port, () => {
    console.log(`🚀 API Self-Hosted rodando na porta ${port}`);
    console.log(`🔗 WebSocket rodando na porta ${process.env.WEBSOCKET_PORT || 3001}`);
    console.log(`📊 Health check: http://localhost:${port}/api/health`);
});

module.exports = app;
EOF

# ===== PASSO 11: INSTALAR DEPENDÊNCIAS =====
log "Instalando dependências..."
npm install

# ===== PASSO 12: CONFIGURAR PERMISSÕES =====
log "Configurando permissões..."
chown -R leaf:leaf /home/leaf/leaf-app

# ===== PASSO 13: INICIAR COM PM2 =====
log "Iniciando aplicação com PM2..."
cd /home/leaf/leaf-app
pm2 start server.js --name "leaf-api"
pm2 save

# ===== PASSO 14: CONFIGURAR FIREWALL =====
log "Configurando firewall..."
ufw allow ssh
ufw allow 80
ufw allow 443
ufw allow 3000
ufw allow 3001
ufw --force enable

# ===== PASSO 15: CRIAR SCRIPT DE DEPLOY =====
log "Criando script de deploy..."
cat > /home/leaf/leaf-app/deploy.sh << 'EOF'
#!/bin/bash

echo "🚀 Deploy Leaf App Self-Hosted"

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
echo "📊 Status: http://$(curl -s ifconfig.me)/health"
EOF

chmod +x /home/leaf/leaf-app/deploy.sh

# ===== PASSO 16: TESTAR SISTEMA =====
log "Testando sistema..."
sleep 5

# Testar API
if curl -s http://localhost:3000/api/health | grep -q "success"; then
    success "API funcionando"
else
    error "API não está funcionando"
fi

# Testar Nginx
if curl -s http://localhost/api/health | grep -q "success"; then
    success "Nginx funcionando"
else
    error "Nginx não está funcionando"
fi

# ===== PASSO 17: MOSTRAR INFORMAÇÕES =====
echo ""
echo "🎉 SETUP CONCLUÍDO!"
echo "=================="
echo ""
echo "📊 Status dos serviços:"
pm2 status
echo ""
echo "🌐 URLs:"
echo "  - API: http://$(curl -s ifconfig.me)/api"
echo "  - Health: http://$(curl -s ifconfig.me)/health"
echo "  - WebSocket: ws://$(curl -s ifconfig.me)/ws"
echo ""
echo "🔧 Comandos úteis:"
echo "  - Ver logs: pm2 logs leaf-api"
echo "  - Reiniciar: pm2 restart leaf-api"
echo "  - Deploy: /home/leaf/leaf-app/deploy.sh"
echo ""
echo "🔑 Redis Password: leaf_redis_2024"
echo ""
echo "📱 Próximo passo: Atualizar mobile app com as novas URLs"
echo ""

success "Setup self-hosted concluído com sucesso!" 