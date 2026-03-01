#!/bin/bash

# DEPLOY DA CORREÇÃO DO rideAccepted PARA VPS VULTR
# Corrige o problema onde o customer não recebia rideAccepted após driver aceitar

set -e

VPS_IP="216.238.107.59"
VPS_USER="root"
PROJECT_DIR="/root/leaf-websocket-backend"

echo "🚀 DEPLOY DA CORREÇÃO rideAccepted"
echo "=================================="
echo "🌐 VPS: $VPS_IP"
echo "📁 Diretório: $PROJECT_DIR"
echo ""

# Verificar se server.js existe localmente
if [ ! -f "server.js" ]; then
    echo "❌ Erro: server.js não encontrado no diretório atual"
    echo "Execute este script de dentro de leaf-websocket-backend/"
    exit 1
fi

echo "📤 Passo 1: Copiando server.js corrigido para VPS..."
scp server.js $VPS_USER@$VPS_IP:$PROJECT_DIR/server.js

echo "✅ Arquivo copiado!"
echo ""

echo "🛑 Passo 2: Parando servidor atual..."
ssh $VPS_USER@$VPS_IP << 'EOF'
    cd /root/leaf-websocket-backend
    
    # Parar processos Node.js do servidor
    echo "🛑 Parando processos do servidor..."
    pkill -f "node.*server.js" || true
    pkill -f "pm2.*server" || true
    
    # Aguardar processos pararem
    sleep 3
    
    # Verificar se parou
    if pgrep -f "node.*server.js" > /dev/null; then
        echo "⚠️ Alguns processos ainda estão rodando, forçando parada..."
        pkill -9 -f "node.*server.js" || true
        sleep 2
    fi
    
    echo "✅ Servidor parado!"
EOF

echo ""

echo "🚀 Passo 3: Iniciando servidor com código corrigido..."
ssh $VPS_USER@$VPS_IP << 'EOF'
    cd /root/leaf-websocket-backend
    
    echo "🚀 Iniciando servidor..."
    
    # Verificar se usa PM2 ou nohup
    if command -v pm2 &> /dev/null; then
        echo "📦 Usando PM2..."
        pm2 start server.js --name leaf-backend --update-env || pm2 restart leaf-backend --update-env
        pm2 save
    else
        echo "📦 Usando nohup..."
        nohup node server.js > server.log 2>&1 &
        echo "✅ Servidor iniciado com PID: $!"
    fi
    
    # Aguardar inicialização
    echo "⏳ Aguardando servidor inicializar..."
    sleep 5
    
    echo "✅ Servidor iniciado!"
EOF

echo ""

echo "🔍 Passo 4: Verificando se servidor está rodando..."
ssh $VPS_USER@$VPS_IP << 'EOF'
    cd /root/leaf-websocket-backend
    
    # Verificar processos
    if pgrep -f "node.*server.js" > /dev/null; then
        echo "✅ Servidor está rodando!"
        ps aux | grep "[n]ode.*server.js" | head -1
    else
        echo "❌ Servidor não está rodando!"
        echo "📋 Últimas linhas do log:"
        tail -20 server.log 2>/dev/null || echo "Log não encontrado"
        exit 1
    fi
    
    # Verificar porta 3001
    if netstat -tuln | grep -q ":3001"; then
        echo "✅ Porta 3001 está ouvindo!"
    else
        echo "⚠️ Porta 3001 não está ouvindo ainda (pode estar iniciando)"
    fi
EOF

echo ""

echo "🧪 Passo 5: Testando conexão..."
sleep 3

if curl -s --connect-timeout 5 http://$VPS_IP:3001/health > /dev/null 2>&1; then
    echo "✅ Health check: OK"
elif curl -s --connect-timeout 5 http://$VPS_IP/health > /dev/null 2>&1; then
    echo "✅ Health check (via proxy): OK"
else
    echo "⚠️ Health check não respondeu (servidor pode estar ainda inicializando)"
fi

echo ""
echo "=================================="
echo "✅ DEPLOY CONCLUÍDO!"
echo "=================================="
echo ""
echo "📋 Mudanças aplicadas:"
echo "  ✅ server.js corrigido no servidor"
echo "  ✅ Servidor reiniciado"
echo ""
echo "🔍 Correções no código:"
echo "  ✅ Armazena booking no io.activeBookings ao criar"
echo "  ✅ Busca customerId do booking ao aceitar"
echo "  ✅ Notifica customer específico via socket"
echo "  ✅ Fallback para broadcast se necessário"
echo ""
echo "🧪 Para testar:"
echo "  cd tests && node run-complete-flow.js --url ws://$VPS_IP:3001"
echo ""


