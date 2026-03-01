#!/bin/bash

# 🚀 DEPLOY AUTOMÁTICO PARA VPS - VERSÃO COMPLETA
# Deploy da nossa versão atualizada com todos os eventos

echo "🚀 DEPLOY AUTOMÁTICO PARA VPS - VERSÃO COMPLETA"
echo "================================================"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

highlight() {
    echo -e "${PURPLE}🔥 $1${NC}"
}

# Configurações da VPS
VPS_IP="216.238.107.59"
VPS_PORT="3001"
VPS_USER="root"  # Ajuste conforme necessário
VPS_PATH="/root/leaf-backend"  # Ajuste conforme necessário

log "📋 CONFIGURAÇÕES DO DEPLOY:"
echo "   VPS IP: $VPS_IP"
echo "   VPS Port: $VPS_PORT"
echo "   VPS User: $VPS_USER"
echo "   VPS Path: $VPS_PATH"
echo ""

# Verificar se estamos no diretório correto
if [ ! -f "leaf-websocket-backend/server.js" ]; then
    error "Execute este script no diretório raiz do projeto!"
    exit 1
fi

# 1. Criar arquivo de deploy compactado
log "📦 Criando arquivo de deploy..."
mkdir -p deploy-package
cp leaf-websocket-backend/server.js deploy-package/
cp leaf-websocket-backend/package.json deploy-package/
cp -r leaf-websocket-backend/node_modules deploy-package/ 2>/dev/null || echo "⚠️ node_modules não encontrado localmente"

# Criar script de instalação para VPS
cat > deploy-package/install-on-vps.sh << 'EOF'
#!/bin/bash

echo "🚀 Instalando versão atualizada na VPS..."

# Parar serviço atual
pm2 stop leaf-websocket-server 2>/dev/null || echo "Serviço não estava rodando"

# Backup do servidor atual
cp server.js server.js.backup-$(date +%Y%m%d-%H%M%S) 2>/dev/null || echo "Sem backup anterior"

# Instalar dependências se necessário
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
fi

# Iniciar serviço atualizado
echo "🚀 Iniciando servidor atualizado..."
pm2 start server.js --name leaf-websocket-server

# Verificar status
pm2 status

echo "✅ Deploy concluído!"
echo "🔍 Teste: curl http://localhost:3001/health"
EOF

chmod +x deploy-package/install-on-vps.sh

# Criar arquivo de instruções
cat > deploy-package/README-DEPLOY.md << 'EOF'
# 🚀 DEPLOY VPS - VERSÃO COMPLETA

## 📦 Arquivos incluídos:
- `server.js` - Servidor atualizado com todos os eventos
- `package.json` - Dependências
- `node_modules/` - Dependências instaladas
- `install-on-vps.sh` - Script de instalação automática

## 🚀 Como fazer o deploy:

### Opção 1: Upload manual
```bash
# 1. Fazer upload dos arquivos para VPS
scp -r deploy-package/* root@216.238.107.59:/root/leaf-backend/

# 2. Conectar na VPS
ssh root@216.238.107.59

# 3. Executar instalação
cd /root/leaf-backend
chmod +x install-on-vps.sh
./install-on-vps.sh
```

### Opção 2: Deploy automático (se SSH configurado)
```bash
# Executar script de deploy automático
./deploy-to-vps-auto.sh
```

## 🧪 Testar após deploy:
```bash
# Health check
curl http://216.238.107.59:3001/health

# Teste de eventos
node test-vps-connection.js
```

## 📊 Eventos implementados:
- ✅ authenticate
- ✅ setDriverStatus
- ✅ updateDriverLocation
- ✅ createBooking
- ✅ confirmPayment
- ✅ driverResponse
- ✅ startTrip
- ✅ completeTrip
- ✅ submitRating
- ✅ searchDrivers
- ✅ cancelRide
- ✅ submitFeedback

## 🔧 Configurações VPS:
- Max conexões: 10,000 (otimizado para VPS)
- Workers: máximo 2
- Timeout: 30 segundos
- Compressão: habilitada
- Batch Redis: habilitado
EOF

# Criar script de deploy automático
cat > deploy-to-vps-auto.sh << 'EOF'
#!/bin/bash

echo "🚀 DEPLOY AUTOMÁTICO PARA VPS..."

VPS_IP="216.238.107.59"
VPS_USER="root"
VPS_PATH="/root/leaf-backend"

# Verificar se SSH está configurado
if ! ssh -o ConnectTimeout=5 $VPS_USER@$VPS_IP "echo 'SSH OK'" 2>/dev/null; then
    echo "❌ SSH não configurado. Use deploy manual."
    echo "📋 Instruções em deploy-package/README-DEPLOY.md"
    exit 1
fi

echo "📤 Fazendo upload dos arquivos..."
scp -r deploy-package/* $VPS_USER@$VPS_IP:$VPS_PATH/

echo "🚀 Executando instalação na VPS..."
ssh $VPS_USER@$VPS_IP "cd $VPS_PATH && chmod +x install-on-vps.sh && ./install-on-vps.sh"

echo "✅ Deploy automático concluído!"
echo "🧪 Testando..."
curl -s http://$VPS_IP:3001/health | jq .
EOF

chmod +x deploy-to-vps-auto.sh

# Criar script de teste pós-deploy
cat > test-vps-post-deploy.js << 'EOF'
#!/usr/bin/env node

/**
 * 🧪 TESTE PÓS-DEPLOY VPS
 * Verifica se todos os eventos estão funcionando após o deploy
 */

const io = require('socket.io-client');

const VPS_URL = 'http://216.238.107.59:3001';
const TEST_DRIVER_ID = 'test-post-deploy-' + Date.now();

const log = {
    info: (msg) => console.log(`\x1b[36mℹ️  ${msg}\x1b[0m`),
    success: (msg) => console.log(`\x1b[32m✅ ${msg}\x1b[0m`),
    error: (msg) => console.log(`\x1b[31m❌ ${msg}\x1b[0m`),
    warning: (msg) => console.log(`\x1b[33m⚠️  ${msg}\x1b[0m`),
    test: (msg) => console.log(`\x1b[35m🧪 ${msg}\x1b[0m`)
};

async function testPostDeploy() {
    log.info('🚀 Testando VPS pós-deploy...');
    
    // Teste 1: Health Check
    log.test('Teste 1: Health Check');
    try {
        const response = await fetch(`${VPS_URL}/health`);
        const health = await response.json();
        
        if (health.status === 'healthy') {
            log.success('Health check passou');
            log.info(`Instância: ${health.instance || 'N/A'}`);
            
            // Verificar se tem métricas completas
            if (health.metrics) {
                log.info(`Conexões: ${health.metrics.connections || 'N/A'}`);
                log.info(`Max conexões: ${health.metrics.maxConnections || 'N/A'}`);
                log.info(`Workers: ${health.metrics.workers || 'N/A'}`);
            }
        } else {
            log.error('Health check falhou');
            return false;
        }
    } catch (error) {
        log.error(`Falha no health check: ${error.message}`);
        return false;
    }
    
    // Teste 2: Eventos básicos
    log.test('Teste 2: Eventos básicos');
    try {
        const socket = io(VPS_URL, {
            transports: ['websocket', 'polling'],
            timeout: 15000,
            forceNew: true
        });
        
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject('Timeout - eventos básicos');
            }, 15000);
            
            socket.on('connect', () => {
                // Testar autenticação
                socket.emit('authenticate', { uid: TEST_DRIVER_ID });
                
                socket.once('authenticated', (data) => {
                    if (data.success) {
                        log.success('Autenticação funcionando');
                        
                        // Testar status do driver
                        socket.emit('setDriverStatus', {
                            driverId: TEST_DRIVER_ID,
                            status: 'online',
                            isOnline: true
                        });
                        
                        socket.once('driverStatusUpdated', (data) => {
                            if (data.success) {
                                log.success('setDriverStatus funcionando');
                                
                                // Testar atualização de localização
                                socket.emit('updateDriverLocation', {
                                    driverId: TEST_DRIVER_ID,
                                    lat: -23.5505,
                                    lng: -46.6333,
                                    heading: 90,
                                    speed: 0
                                });
                                
                                socket.once('locationUpdated', (data) => {
                                    if (data.success) {
                                        log.success('updateDriverLocation funcionando');
                                        clearTimeout(timeout);
                                        resolve();
                                    } else {
                                        reject('Falha no updateDriverLocation');
                                    }
                                });
                            } else {
                                reject('Falha no setDriverStatus');
                            }
                        });
                    } else {
                        reject('Falha na autenticação');
                    }
                });
            });
        });
        
        socket.disconnect();
        
    } catch (error) {
        log.error(`Falha nos eventos básicos: ${error}`);
        return false;
    }
    
    log.success('🎉 VPS funcionando perfeitamente pós-deploy!');
    log.info('📊 Todos os eventos principais funcionando:');
    log.info('   - authenticate: ✅');
    log.info('   - setDriverStatus: ✅');
    log.info('   - updateDriverLocation: ✅');
    log.info('');
    log.info('🚀 App mobile pronto para usar a VPS!');
    
    return true;
}

// Executar testes
testPostDeploy().catch(error => {
    log.error(`Erro nos testes: ${error.message}`);
    process.exit(1);
});
EOF

chmod +x test-vps-post-deploy.js

# Resumo final
log "📊 DEPLOY PREPARADO COM SUCESSO!"
echo ""
success "✅ Arquivos de deploy criados em: deploy-package/"
success "✅ Script de instalação: deploy-package/install-on-vps.sh"
success "✅ Deploy automático: deploy-to-vps-auto.sh"
success "✅ Teste pós-deploy: test-vps-post-deploy.js"
success "✅ Instruções: deploy-package/README-DEPLOY.md"
echo ""
highlight "🚀 PRÓXIMOS PASSOS:"
echo "1. Escolher método de deploy:"
echo "   - Automático: ./deploy-to-vps-auto.sh"
echo "   - Manual: Seguir instruções em deploy-package/README-DEPLOY.md"
echo ""
echo "2. Após deploy, testar:"
echo "   - ./test-vps-post-deploy.js"
echo ""
echo "3. App mobile já está configurado para VPS!"
echo ""
success "🎉 Deploy pronto para ser executado!"

EOF

chmod +x deploy-to-vps-complete.sh


