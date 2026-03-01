#!/bin/bash

# 🚀 DEPLOY LEAF APP PARA HOSTINGER VPS
# Script para transferir e executar o setup na VPS

echo "🚀 DEPLOY LEAF APP PARA HOSTINGER VPS"
echo "======================================"

# 🔑 Configurações
VPS_IP="147.93.66.253"
VPS_USER="root"
SETUP_FILE="setup-hostinger-leaf.sh"

echo "📡 Conectando à VPS: ${VPS_USER}@${VPS_IP}"

# 📤 Transferir arquivo para VPS
echo "📤 Transferindo setup para VPS..."
scp ${SETUP_FILE} ${VPS_USER}@${VPS_IP}:/tmp/

if [ $? -eq 0 ]; then
    echo "✅ Arquivo transferido com sucesso!"
else
    echo "❌ Erro ao transferir arquivo"
    exit 1
fi

# 🔧 Executar setup na VPS
echo "🔧 Executando setup na VPS..."
ssh ${VPS_USER}@${VPS_IP} << 'EOF'
    echo "🌿 INICIANDO SETUP LEAF APP NA HOSTINGER VPS"
    echo "============================================="
    
    # 📊 Verificar sistema
    echo "📊 Verificando sistema..."
    echo "RAM: $(free -h | grep Mem | awk '{print $3"/"$2}')"
    echo "Disco: $(df -h / | tail -1 | awk '{print $3"/"$2}')"
    echo "CPU: $(nproc) cores"
    
    # 🔧 Atualizar sistema
    echo "🔧 Atualizando sistema..."
    apt update -y
    apt upgrade -y
    
    # 📦 Instalar dependências
    echo "📦 Instalando dependências..."
    apt install -y curl wget git unzip software-properties-common apt-transport-https ca-certificates gnupg lsb-release
    
    # 🟢 Instalar Node.js 18
    echo "🟢 Instalar Node.js 18..."
    if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        apt-get install -y nodejs
    else
        echo "✅ Node.js já instalado: $(node --version)"
    fi
    
    # 🔴 Instalar Redis
    echo "🔴 Instalar Redis..."
    if ! command -v redis-server &> /dev/null; then
        apt install -y redis-server
        
        # Configurar Redis
        sed -i 's/bind 216.238.107.59/bind 0.0.0.0/' /etc/redis/redis.conf
        sed -i 's/# requirepass foobared/requirepass leaf_redis_2024/' /etc/redis/redis.conf
        sed -i 's/maxmemory 256mb/maxmemory 2gb/' /etc/redis/redis.conf
        sed -i 's/maxmemory-policy noeviction/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf
        
        systemctl enable redis-server
        systemctl start redis-server
    else
        echo "✅ Redis já instalado"
    fi
    
    # 📁 Criar diretório do projeto
    echo "📁 Criando diretório do projeto..."
    mkdir -p /opt/leaf-app
    cd /opt/leaf-app
    
    # 📄 Criar package.json
    echo "📄 Criando package.json..."
    cat > package.json << 'PACKAGE_EOF'
{
  "name": "leaf-app-api",
  "version": "1.0.0",
  "description": "Leaf App Self-Hosted API",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "pm2:start": "pm2 start server.js --name leaf-api",
    "pm2:stop": "pm2 stop leaf-api",
    "pm2:restart": "pm2 restart leaf-api",
    "pm2:logs": "pm2 logs leaf-api"
  },
  "dependencies": {
    "express": "^4.18.2",
    "redis": "^4.6.7",
    "ws": "^8.13.0",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "express-rate-limit": "^6.7.0",
    "dotenv": "^16.3.1",
    "axios": "^1.4.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
PACKAGE_EOF
    
    # 🔐 Criar arquivo .env
    echo "🔐 Criando arquivo .env..."
    cat > .env << 'ENV_EOF'
# 🌿 LEAF APP - CONFIGURAÇÃO
NODE_ENV=production
PORT=3000
WS_PORT=3001
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=leaf_redis_2024
REDIS_DB=0

# 🔑 API KEYS (configurar depois)
MAPBOX_API_KEY=pk.eyJ1IjoibGVhZi1hcHAiLCJhIjoiY205MHJxazByMGlybzJrcTIyZ25wdm1maSJ9.aX1wTUINIhk_nsQAACNnyA
LOCATIONIQ_API_KEY=pk.59262794905b7196e5a09bf1fd47911d
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

# 🔒 SEGURANÇA
CORS_ORIGIN=*
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# 📊 MONITORAMENTO
ENABLE_METRICS=true
LOG_LEVEL=info
ENV_EOF
    
    # 🖥️ Criar server.js
    echo "🖥️ Criando server.js..."
    cat > server.js << 'SERVER_EOF'
// 🏠 LEAF APP - SELF-HOSTED API
const express = require('express');
const redis = require('redis');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const wsPort = process.env.WS_PORT || 3001;

// 🔒 Configurações de segurança
app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));

// 🚦 Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: 'Muitas requisições, tente novamente mais tarde.'
});
app.use(limiter);

// 📊 Middleware de logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// 🔴 Redis Client
const redisClient = redis.createClient({
    socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379
    },
    password: process.env.REDIS_PASSWORD || 'leaf_redis_2024',
    database: parseInt(process.env.REDIS_DB) || 0
});

redisClient.on('error', (err) => {
    console.error('🔴 Redis Error:', err);
});

redisClient.on('connect', () => {
    console.log('🔴 Redis conectado com sucesso!');
});

// 🔗 Conectar Redis
(async () => {
    await redisClient.connect();
})();

// 🏠 Health Check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        redis: redisClient.isReady ? 'connected' : 'disconnected'
    });
});

// 📍 API - Atualizar localização do usuário
app.post('/api/update_user_location', async (req, res) => {
    try {
        const { userId, lat, lng, timestamp } = req.body;
        
        if (!userId || !lat || !lng) {
            return res.status(400).json({ error: 'Dados obrigatórios: userId, lat, lng' });
        }

        const locationData = {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            timestamp: timestamp || Date.now()
        };

        await redisClient.hSet(`user:${userId}:location`, locationData);
        await redisClient.expire(`user:${userId}:location`, 3600); // 1 hora

        res.json({ success: true, message: 'Localização atualizada' });
    } catch (error) {
        console.error('Erro ao atualizar localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// 🚗 API - Atualizar localização do motorista
app.post('/api/update_driver_location', async (req, res) => {
    try {
        const { driverId, lat, lng, status, timestamp } = req.body;
        
        if (!driverId || !lat || !lng) {
            return res.status(400).json({ error: 'Dados obrigatórios: driverId, lat, lng' });
        }

        const locationData = {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            status: status || 'available',
            timestamp: timestamp || Date.now()
        };

        await redisClient.hSet(`driver:${driverId}:location`, locationData);
        await redisClient.expire(`driver:${driverId}:location`, 3600); // 1 hora

        // Adicionar à lista de motoristas ativos
        await redisClient.zAdd('active_drivers', {
            score: Date.now(),
            value: driverId
        });

        res.json({ success: true, message: 'Localização do motorista atualizada' });
    } catch (error) {
        console.error('Erro ao atualizar localização do motorista:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// 🔍 API - Buscar motoristas próximos
app.get('/api/nearby_drivers', async (req, res) => {
    try {
        const { lat, lng, radius = 5 } = req.query;
        
        if (!lat || !lng) {
            return res.status(400).json({ error: 'Parâmetros obrigatórios: lat, lng' });
        }

        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const searchRadius = parseFloat(radius);

        // Buscar motoristas ativos
        const activeDrivers = await redisClient.zRange('active_drivers', 0, -1);
        const nearbyDrivers = [];

        for (const driverId of activeDrivers) {
            const driverLocation = await redisClient.hGetAll(`driver:${driverId}:location`);
            
            if (driverLocation.lat && driverLocation.lng) {
                const distance = calculateDistance(
                    userLat, userLng,
                    parseFloat(driverLocation.lat), parseFloat(driverLocation.lng)
                );

                if (distance <= searchRadius) {
                    nearbyDrivers.push({
                        driverId,
                        lat: parseFloat(driverLocation.lat),
                        lng: parseFloat(driverLocation.lng),
                        status: driverLocation.status || 'available',
                        distance: distance.toFixed(2)
                    });
                }
            }
        }

        // Ordenar por distância
        nearbyDrivers.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

        res.json({
            success: true,
            drivers: nearbyDrivers,
            count: nearbyDrivers.length
        });
    } catch (error) {
        console.error('Erro ao buscar motoristas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// 📊 API - Estatísticas
app.get('/api/stats', async (req, res) => {
    try {
        const activeDrivers = await redisClient.zCard('active_drivers');
        const redisInfo = await redisClient.info();
        
        res.json({
            activeDrivers,
            redisInfo: redisInfo.split('\n').slice(0, 10), // Primeiras 10 linhas
            uptime: process.uptime(),
            memory: process.memoryUsage()
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// 🧮 Função para calcular distância (Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// 🖥️ Iniciar servidor HTTP
app.listen(port, () => {
    console.log(`🚀 Leaf API rodando na porta ${port}`);
    console.log(`📊 Health check: http://localhost:${port}/api/health`);
});

// 🔌 WebSocket Server
const wss = new WebSocket.Server({ port: wsPort });

wss.on('connection', (ws, req) => {
    console.log('🔌 Nova conexão WebSocket:', req.socket.remoteAddress);
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            // Processar mensagens WebSocket
            if (data.type === 'location_update') {
                // Broadcast para outros clientes
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
            }
        } catch (error) {
            console.error('Erro ao processar mensagem WebSocket:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 Conexão WebSocket fechada');
    });
});

console.log(`🔌 WebSocket rodando na porta ${wsPort}`);

// 🛑 Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 Recebido SIGTERM, fechando...');
    await redisClient.quit();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Recebido SIGINT, fechando...');
    await redisClient.quit();
    process.exit(0);
});

module.exports = app;
SERVER_EOF
    
    # 📦 Instalar dependências
    echo "📦 Instalando dependências..."
    npm install
    
    # 🚀 Instalar PM2
    echo "🚀 Instalar PM2..."
    npm install -g pm2
    
    # 🔧 Configurar PM2
    echo "🔧 Configurar PM2..."
    pm2 startup
    pm2 start server.js --name leaf-api
    pm2 save
    
    # 🔒 Configurar firewall
    echo "🔒 Configurar firewall..."
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 3000/tcp
    ufw allow 3001/tcp
    ufw allow 6379/tcp
    ufw --force enable
    
    # 📊 Verificar status
    echo "📊 Verificar status..."
    echo "✅ Node.js: $(node --version)"
    echo "✅ NPM: $(npm --version)"
    echo "✅ Redis: $(redis-cli ping)"
    echo "✅ PM2: $(pm2 status)"
    
    # 🎯 URLs finais
    echo ""
    echo "🎯 LEAF APP CONFIGURADO COM SUCESSO!"
    echo "====================================="
    echo "🌐 API: http://147.93.66.253:3000"
    echo "🔌 WebSocket: ws://147.93.66.253:3001"
    echo "📊 Health: http://147.93.66.253:3000/api/health"
    echo "📈 Stats: http://147.93.66.253:3000/api/stats"
    echo ""
    echo "🔧 Comandos úteis:"
    echo "  pm2 status          - Ver status"
    echo "  pm2 logs leaf-api   - Ver logs"
    echo "  pm2 restart leaf-api - Reiniciar"
    echo "  pm2 stop leaf-api   - Parar"
    echo ""
    echo "🔑 Redis password: leaf_redis_2024"
    echo "📁 Diretório: /opt/leaf-app"
EOF

echo ""
echo "🎯 DEPLOY CONCLUÍDO!"
echo "===================="
echo "✅ Leaf App configurado na VPS da Hostinger"
echo "🌐 API: http://147.93.66.253:3000"
echo "🔌 WebSocket: ws://147.93.66.253:3001"
echo ""
echo "🔧 Para verificar status:"
echo "ssh root@147.93.66.253 'pm2 status'"
echo ""
echo "📊 Para ver logs:"
echo "ssh root@147.93.66.253 'pm2 logs leaf-api'" 