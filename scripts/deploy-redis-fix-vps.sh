#!/bin/bash

# 🚀 DEPLOY: Correções do Redis na VPS
# Aplica as correções do Redis (utils/redis-pool.js e server.js)

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configurações da VPS
VPS_IP="147.93.66.253"
VPS_USER="root"
VPS_PATH="/opt/leaf-app"  # ✅ Corrigido: caminho real na VPS

echo -e "${CYAN}🚀 DEPLOY: CORREÇÕES DO REDIS NA VPS${NC}"
echo "=========================================="
echo -e "${YELLOW}🌐 VPS: ${VPS_IP}${NC}"
echo -e "${YELLOW}📁 Diretório: ${VPS_PATH}${NC}"
echo ""

# Verificar se estamos no diretório correto
if [ ! -f "leaf-websocket-backend/utils/redis-pool.js" ]; then
    echo -e "${RED}❌ Execute este script do diretório raiz do projeto!${NC}"
    exit 1
fi

# Verificar se os arquivos corrigidos existem
if [ ! -f "leaf-websocket-backend/utils/redis-pool.js" ]; then
    echo -e "${RED}❌ Arquivo utils/redis-pool.js não encontrado!${NC}"
    exit 1
fi

# Testar conexão SSH
echo -e "${BLUE}🔍 Testando conexão SSH...${NC}"
if ! ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_IP} "echo 'Conexão OK'" 2>/dev/null; then
    echo -e "${RED}❌ Erro ao conectar na VPS${NC}"
    echo -e "${YELLOW}💡 Verifique se você tem acesso SSH configurado${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Conectado na VPS${NC}"

# ===== PASSO 1: BACKUP DOS ARQUIVOS ATUAIS =====
echo -e "${BLUE}📦 Fazendo backup dos arquivos atuais...${NC}"
ssh ${VPS_USER}@${VPS_IP} << EOF
    cd ${VPS_PATH}
    
    # Criar diretório de backup
    mkdir -p backups/redis-fix-$(date +%Y%m%d-%H%M%S)
    BACKUP_DIR="backups/redis-fix-$(date +%Y%m%d-%H%M%S)"
    
    # Backup dos arquivos
    if [ -f "utils/redis-pool.js" ]; then
        cp utils/redis-pool.js \${BACKUP_DIR}/redis-pool.js.backup
        echo "✅ Backup de utils/redis-pool.js criado"
    fi
    
    if [ -f "server.js" ]; then
        cp server.js \${BACKUP_DIR}/server.js.backup
        echo "✅ Backup de server.js criado"
    fi
    
    echo "📦 Backup salvo em: \${BACKUP_DIR}"
EOF

echo -e "${GREEN}✅ Backup concluído${NC}"

# ===== PASSO 2: ENVIAR ARQUIVOS CORRIGIDOS =====
echo -e "${BLUE}📤 Enviando arquivos corrigidos...${NC}"

# Enviar utils/redis-pool.js
echo -e "${YELLOW}  → Enviando utils/redis-pool.js...${NC}"
scp -o StrictHostKeyChecking=no \
    leaf-websocket-backend/utils/redis-pool.js \
    ${VPS_USER}@${VPS_IP}:${VPS_PATH}/utils/redis-pool.js

# Verificar se server.js precisa ser atualizado (verificar se tem ensureConnection)
if grep -q "ensureConnection" leaf-websocket-backend/server.js; then
    echo -e "${YELLOW}  → Enviando server.js (com ensureConnection)...${NC}"
    scp -o StrictHostKeyChecking=no \
        leaf-websocket-backend/server.js \
        ${VPS_USER}@${VPS_IP}:${VPS_PATH}/server.js
else
    echo -e "${YELLOW}  ⚠️  server.js não precisa ser atualizado (ensureConnection já existe ou não é necessário)${NC}"
fi

echo -e "${GREEN}✅ Arquivos enviados${NC}"

# ===== PASSO 3: VERIFICAR REDIS NA VPS =====
echo -e "${BLUE}🔍 Verificando Redis na VPS...${NC}"
ssh ${VPS_USER}@${VPS_IP} << 'EOF'
    # Verificar se Redis está rodando
    if command -v redis-cli &> /dev/null; then
        if redis-cli ping 2>/dev/null | grep -q PONG; then
            echo "✅ Redis está rodando e respondendo"
        else
            echo "⚠️  Redis não está respondendo (pode estar rodando em Docker)"
            # Verificar Docker
            if command -v docker &> /dev/null; then
                if docker ps | grep -q redis; then
                    echo "✅ Redis está rodando em Docker"
                else
                    echo "❌ Redis não está rodando"
                fi
            fi
        fi
    else
        echo "⚠️  redis-cli não encontrado (Redis pode estar em Docker)"
    fi
EOF

# ===== PASSO 4: REINICIAR SERVIDOR =====
echo -e "${BLUE}🔄 Reiniciando servidor...${NC}"

# Tentar PM2 primeiro (mais comum)
RESTART_METHOD=""
if ssh ${VPS_USER}@${VPS_IP} "command -v pm2 &> /dev/null" 2>/dev/null; then
    RESTART_METHOD="pm2"
    echo -e "${BLUE}🔄 Reiniciando via PM2...${NC}"
    ssh ${VPS_USER}@${VPS_IP} << 'EOF'
        cd /opt/leaf-app
        pm2 restart leaf-websocket 2>/dev/null || \
        pm2 restart leaf-websocket-backend 2>/dev/null || \
        pm2 restart all 2>/dev/null || \
        echo "⚠️  PM2 não encontrou processo, tentando systemd..."
        pm2 save 2>/dev/null || true
EOF
elif ssh ${VPS_USER}@${VPS_IP} "systemctl list-units | grep -q leaf" 2>/dev/null; then
    RESTART_METHOD="systemd"
    echo -e "${BLUE}🔄 Reiniciando via systemd...${NC}"
    ssh ${VPS_USER}@${VPS_IP} << 'EOF'
        systemctl restart leaf-websocket 2>/dev/null || \
        systemctl restart leaf-backend 2>/dev/null || \
        echo "⚠️  Serviço systemd não encontrado"
EOF
else
    RESTART_METHOD="process"
    echo -e "${BLUE}🔄 Reiniciando processo direto...${NC}"
    ssh ${VPS_USER}@${VPS_IP} << 'EOF'
        cd /opt/leaf-app
        PID=$(pgrep -f 'node.*server.js' | head -1)
        if [ ! -z "$PID" ]; then
            kill $PID
            sleep 2
        fi
        nohup node server.js > server.log 2>&1 &
        echo "✅ Servidor reiniciado"
EOF
fi

echo -e "${GREEN}✅ Servidor reiniciado via ${RESTART_METHOD}${NC}"

# ===== PASSO 5: AGUARDAR E TESTAR =====
echo -e "${BLUE}⏳ Aguardando servidor inicializar...${NC}"
sleep 5

echo -e "${BLUE}🧪 Testando servidor...${NC}"
if curl -s --connect-timeout 5 http://${VPS_IP}:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Servidor está respondendo${NC}"
    
    # Testar endpoint de health
    HEALTH_RESPONSE=$(curl -s http://${VPS_IP}:3001/health)
    echo -e "${CYAN}📊 Health Check:${NC}"
    echo "$HEALTH_RESPONSE" | head -5
else
    echo -e "${YELLOW}⚠️  Servidor não está respondendo ainda (pode levar mais tempo)${NC}"
fi

# ===== RESUMO =====
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ DEPLOY CONCLUÍDO${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}📋 Arquivos deployados:${NC}"
echo "  ✅ utils/redis-pool.js"
if [ "$restart_option" != "4" ]; then
    echo "  ✅ server.js (se necessário)"
fi
echo ""
echo -e "${CYAN}🧪 Próximos passos:${NC}"
echo "  1. Testar conexão Redis:"
echo "     node scripts/tests/test-redis-connection.js"
echo ""
echo "  2. Testar eventos completos:"
echo "     node scripts/tests/test-eventos-listeners-completo.js"
echo ""
echo -e "${YELLOW}💡 Se o servidor não reiniciou automaticamente, faça manualmente:${NC}"
echo "     ssh ${VPS_USER}@${VPS_IP}"
echo "     cd ${VPS_PATH}"
echo "     pm2 restart leaf-websocket"
echo ""

